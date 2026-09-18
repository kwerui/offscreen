// Tiny Express server for the voice assistant app.
//
// Two responsibilities:
//   1. Serve the static frontend in /public.
//   2. Mint single-use temporary tokens for the browser at /api/voice-token,
//      so the AssemblyAI API key never leaves the server.
//
// The browser fetches a fresh token before every WebSocket connection.
import {
  getCalendarEvents,
  getCalendarEventsForDate,
  getPrimaryCalendarTimezone,
} from "./calendar.js";
import { parseCalendarQuery } from "./calendar-query.js";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import "dotenv/config";
import { spawn } from "node:child_process";
import {
  createCodexEnvironment,
  createCodexInspectionWorkspace,
  removeCodexInspectionWorkspace,
} from "./codex-runner.js";
import {
  getBrowserResultStatus,
  runBrowserAction,
  validateBrowserRequest,
} from "./browser-mcp.js";
import {
  getCapabilities,
  getClientCapabilities,
} from "./public/capabilities.js";

const PORT = process.env.PORT || 3000;
const HOST = "127.0.0.1";
const TOKEN_TTL_SECONDS = 300; // 1-600
const CODEX_TIMEOUT_MS = 40_000;
const MAX_CODEX_TASK_CHARACTERS = 4_000;
const MAX_CODEX_STDOUT_BYTES = 16 * 1024;
const MAX_CODEX_STDERR_BYTES = 64 * 1024;

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp({
  apiKey = process.env.ASSEMBLYAI_API_KEY,
  mode = process.env.OFFSCREEN_MODE,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey) {
    throw new Error(
      "Missing ASSEMBLYAI_API_KEY in environment. Copy .env.example to .env and add your key."
    );
  }

  const capabilities = getCapabilities(mode);
  const clientCapabilities = getClientCapabilities(mode);
  const app = express();

app.use(express.json());

app.get("/api/capabilities.js", (_req, res) => {
  res.set("Cache-Control", "no-store").type("application/javascript").send(
    `globalThis.__OFFSCREEN_CAPABILITIES__ = ${JSON.stringify(clientCapabilities)};`
  );
});

app.use(express.static(join(__dirname, "public")));

app.get("/api/voice-token", async (_req, res) => {
  try {
    const url = new URL("https://agents.assemblyai.com/v1/token");
    url.searchParams.set("expires_in_seconds", String(TOKEN_TTL_SECONDS));

    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`Token mint failed: ${response.status} ${body}`);
      return res.status(502).json({ error: "Failed to mint token" });
    }

    const { token } = await response.json();
    res.json({ token, expires_in_seconds: TOKEN_TTL_SECONDS });
  } catch (err) {
    console.error("Token mint error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

if (capabilities.calendar) {
app.get("/api/calendar/events", async (req, res) => {
  try {
    const range = req.query.range || "upcoming";

    const allowedRanges = [
      "upcoming",
      "today",
      "tomorrow",
      "this_week",
      "next_week",
      "this_month",
      "next_month",
    ];

    if (!allowedRanges.includes(range)) {
      return res.status(400).json({
        error: "Unsupported calendar range",
      });
    }

    const data = await getCalendarEvents(range);

    res.json(data);
  } catch (err) {
    console.error("Calendar error:", err);

    res.status(500).json({
      error: "Failed to fetch calendar events",
    });
  }
});

app.get("/api/calendar/query", async (req, res) => {
  try {
    const when = String(req.query.when || "").trim();

    if (!when) {
      return res.status(400).json({
        error: "Calendar query is required",
      });
    }

    const calendarQuery = parseCalendarQuery(when);

    if (!calendarQuery) {
      return res.status(400).json({
        error: `Could not understand date: ${when}`,
      });
    }

    if (calendarQuery.type === "range") {
      const data = await getCalendarEvents(calendarQuery.range);

      return res.json(data);
    }

    // Validate before authenticating, then interpret date-dependent language
    // using the timezone configured on the user's primary Google Calendar.
    const calendarTimezone = await getPrimaryCalendarTimezone();
    const timezoneAwareQuery = parseCalendarQuery(
      when,
      new Date(),
      calendarTimezone
    );

    const data = await getCalendarEventsForDate(
      timezoneAwareQuery.date,
      calendarTimezone
    );

    res.json(data);
  } catch (err) {
    console.error("Calendar query error:", err);

    res.status(500).json({
      error: "Failed to process calendar query",
    });
  }
});

app.get("/api/calendar/date", async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        error: "Date is required",
      });
    }

    const data = await getCalendarEventsForDate(date);

    res.json(data);
  } catch (err) {
    console.error("Calendar date error:", err);

    res.status(500).json({
      error: "Failed to fetch calendar events",
    });
  }
});
}

if (capabilities.browserControl) {
app.post("/api/browser", async (req, res) => {
  const action = req.body?.action;
  const validation = validateBrowserRequest(action, req.body);

  if (!validation.success) {
    return res.status(400).json(validation);
  }

  const result = await runBrowserAction(action, req.body);

  res.status(getBrowserResultStatus(result)).json(result);
});
}

if (capabilities.codex) {
app.post("/api/codex", async (req, res) => {
  const task = String(req.body?.task || "").trim();

  if (!task) {
    return res.status(400).json({
      error: "Codex task is required",
    });
  }

  if (task.length > MAX_CODEX_TASK_CHARACTERS) {
    return res.status(400).json({
      error: "Codex task is too long",
    });
  }

  console.log(`Codex task received (${task.length} characters)`);

  const codexTask =
    `${task}\n\n` +
    "Answer in at most 3 short sentences. " +
    "Do not use subagents or delegate this task. " +
    "Do not perform a broad repository review unless necessary. " +
    "Inspect only the minimum files needed to answer the question. " +
    "Stop as soon as you have enough information to answer.";

  let inspectionWorkspace;

  try {
    inspectionWorkspace = await createCodexInspectionWorkspace(__dirname);
  } catch (error) {
    console.error("Could not prepare Codex inspection workspace:", error.message);
    return res.status(500).json({ error: "Failed to prepare Codex" });
  }

  const child = spawn(
    "codex",
    [
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "-c",
      'model_reasoning_effort="low"',
      codexTask,
    ],

    {
      cwd: inspectionWorkspace,
      env: createCodexEnvironment(),
    }
  );

  child.stdin.end();

  let stdout = "";
  let stderr = "";
  let capturedStdoutBytes = 0;
  let capturedStderrBytes = 0;
  let stderrWasTruncated = false;
  let hasResponded = false;
  let timeoutId = null;
  let workspaceWasRemoved = false;

  async function removeInspectionWorkspaceOnce() {
    if (workspaceWasRemoved) {
      return;
    }
    workspaceWasRemoved = true;

    try {
      await removeCodexInspectionWorkspace(inspectionWorkspace);
    } catch (error) {
      console.error("Could not remove Codex inspection workspace:", error.message);
    }
  }

  function sendResponseOnce(status, responseBody) {
    if (hasResponded) {
      return;
    }

    hasResponded = true;

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    res.status(status).json(responseBody);
  }

  function terminateCodexProcess() {
    if (child.killed || child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    try {
      child.kill("SIGTERM");
    } catch (error) {
      console.error("Could not terminate Codex process:", error.message);
    }
  }

  function captureCodexOutput(streamName, data) {
    if (hasResponded) {
      return;
    }

    const chunkBytes = Buffer.byteLength(data);

    if (streamName === "stdout") {
      if (capturedStdoutBytes + chunkBytes > MAX_CODEX_STDOUT_BYTES) {
        console.error("Codex stdout exceeded the capture limit");
        sendResponseOnce(500, { error: "Codex produced too much output" });
        terminateCodexProcess();
        return;
      }

      capturedStdoutBytes += chunkBytes;
      stdout += data.toString();
      return;
    }

    if (capturedStderrBytes >= MAX_CODEX_STDERR_BYTES) {
      stderrWasTruncated = true;
      return;
    }

    const remainingStderrBytes =
      MAX_CODEX_STDERR_BYTES - capturedStderrBytes;
    const capturedChunk = data.subarray(
      0,
      remainingStderrBytes
    );

    stderr += capturedChunk.toString();
    capturedStderrBytes += capturedChunk.length;

    if (capturedChunk.length < chunkBytes) {
      stderrWasTruncated = true;
    }
  }

  child.stdout.on("data", (data) => {
    captureCodexOutput("stdout", data);
  });

  child.stderr.on("data", (data) => {
    captureCodexOutput("stderr", data);
  });

  timeoutId = setTimeout(() => {
    console.error(`Codex timed out after ${CODEX_TIMEOUT_MS}ms`);
    sendResponseOnce(504, { error: "Codex request timed out" });
    terminateCodexProcess();
  }, CODEX_TIMEOUT_MS);

  child.on("error", (err) => {
    console.error("Codex process error:", err.message);
    sendResponseOnce(500, { error: "Failed to start Codex" });
    removeInspectionWorkspaceOnce();
  });

  child.on("close", async (code) => {
    await removeInspectionWorkspaceOnce();

    if (hasResponded) {
      return;
    }

    console.log(`Codex exited with code ${code}`);

    if (code !== 0) {
      console.error(
        `Codex stderr captured (${capturedStderrBytes} bytes${
          stderrWasTruncated ? ", truncated" : ""
        })`
      );
      sendResponseOnce(500, { error: "Codex could not complete the request" });
      return;
    }

    sendResponseOnce(200, {
      success: true,
      output: stdout.trim(),
    });
  });
});
}

  return app;
}

export function startServer() {
  const app = createApp();

  return app.listen(PORT, HOST, () => {
    console.log(`Voice assistant app running at http://${HOST}:${PORT}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer();
}
