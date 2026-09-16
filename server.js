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
} from "./calendar.js";
import { parseCalendarQuery } from "./calendar-query.js";
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import "dotenv/config";
import { spawn } from "node:child_process";

const API_KEY = process.env.ASSEMBLYAI_API_KEY;
if (!API_KEY) {
  console.error("Missing ASSEMBLYAI_API_KEY in environment. Copy .env.example to .env and add your key.");
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const TOKEN_TTL_SECONDS = 300; // 1-600

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());

app.use(express.static(join(__dirname, "public")));

app.get("/api/voice-token", async (_req, res) => {
  try {
    const url = new URL("https://agents.assemblyai.com/v1/token");
    url.searchParams.set("expires_in_seconds", String(TOKEN_TTL_SECONDS));

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${API_KEY}` },
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

    const data = await getCalendarEventsForDate(calendarQuery.date);

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

app.post("/api/codex", async (req, res) => {
  const task = String(req.body?.task || "").trim();

  if (!task) {
    return res.status(400).json({
      error: "Codex task is required",
    });
  }

 console.log("CODEX TASK:", task);

const codexTask =
  `${task}\n\n` +
  "Answer in at most 3 short sentences. " +
  "Do not use subagents or delegate this task. " +
  "Do not perform a broad repository review unless necessary. " +
  "Inspect only the minimum files needed to answer the question. " +
  "Stop as soon as you have enough information to answer.";

const child = spawn(
  "codex",
  [
    "exec",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "-c",
    'model_reasoning_effort="low"',
    codexTask,
  ],

    {
      cwd: process.cwd(),
      env: process.env,
    }
  );

  child.stdin.end();

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (data) => {
    stdout += data.toString();
  });

  child.stderr.on("data", (data) => {
    stderr += data.toString();
  });

  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
  }, 120_000);

  child.on("error", (err) => {
    clearTimeout(timeout);

    console.error("Codex process error:", err);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Failed to start Codex",
      });
    }
  });

  child.on("close", (code) => {
    clearTimeout(timeout);

    console.log("CODEX EXIT:", code);

    if (code !== 0) {
      return res.status(500).json({
        error:
          stderr.trim() ||
          `Codex exited with code ${code}`,
      });
    }

    res.json({
      success: true,
      output: stdout.trim(),
    });
  });
});

app.listen(PORT, () => {
  console.log(`Voice assistant app running at http://localhost:${PORT}`);
});
