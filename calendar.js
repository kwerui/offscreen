import path from "node:path";
import process from "node:process";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
];

const CREDENTIALS_PATH = path.join(
  process.cwd(),
  "credentials.json"
);

let authClient = null;

async function getAuthClient() {
  if (!authClient) {
    authClient = await authenticate({
      scopes: SCOPES,
      keyfilePath: CREDENTIALS_PATH,
    });
  }

  return authClient;
}

export async function getUpcomingEvents(maxResults = 5) {
  const auth = await getAuthClient();

  const calendar = google.calendar({
    version: "v3",
    auth,
  });

  const result = await calendar.events.list({
    calendarId: "primary",
    timeMin: new Date().toISOString(),
    maxResults,
    singleEvents: true,
    orderBy: "startTime",
  });

  return (result.data.items || []).map((event) => ({
    title: event.summary || "Untitled event",
    start:
      event.start?.dateTime ??
      event.start?.date ??
      null,
    end:
      event.end?.dateTime ??
      event.end?.date ??
      null,
  }));
}