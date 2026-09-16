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
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import "dotenv/config";
import * as chrono from "chrono-node";

const API_KEY = process.env.ASSEMBLYAI_API_KEY;
if (!API_KEY) {
  console.error("Missing ASSEMBLYAI_API_KEY in environment. Copy .env.example to .env and add your key.");
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const TOKEN_TTL_SECONDS = 300; // 1-600

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

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

    const rangeMap = {
      upcoming: "upcoming",
      today: "today",
      tomorrow: "tomorrow",
      "this week": "this_week",
      "next week": "next_week",
      "this month": "this_month",
      "next month": "next_month",
    };

    const normalized = when.toLowerCase();

    if (rangeMap[normalized]) {
      const data = await getCalendarEvents(
        rangeMap[normalized]
      );

      return res.json(data);
    }

    const parsedDate = chrono.parseDate(
      when,
      new Date(),
      {
        forwardDate: true,
      }
    );

    if (!parsedDate) {
      return res.status(400).json({
        error: `Could not understand date: ${when}`,
      });
    }

    const date = [
      parsedDate.getFullYear(),
      String(parsedDate.getMonth() + 1).padStart(2, "0"),
      String(parsedDate.getDate()).padStart(2, "0"),
    ].join("-");

    const data =
      await getCalendarEventsForDate(date);

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

app.listen(PORT, () => {
  console.log(`Voice assistant app running at http://localhost:${PORT}`);
});
