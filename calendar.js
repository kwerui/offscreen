import path from "node:path";
import process from "node:process";
import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";
import { DateTime } from "luxon";

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

export async function getPrimaryCalendarTimezone() {
  const auth = await getAuthClient();
  const calendar = google.calendar({
    version: "v3",
    auth,
  });

  const calendarInfo = await calendar.calendars.get({
    calendarId: "primary",
  });

  return calendarInfo.data.timeZone || "UTC";
}

export async function getCalendarEvents(range = "upcoming") {
  const auth = await getAuthClient();

  const calendar = google.calendar({
    version: "v3",
    auth,
  });

  // Use the timezone configured on the user's primary Google Calendar.
  const calendarInfo = await calendar.calendars.get({
    calendarId: "primary",
  });

  const timezone = calendarInfo.data.timeZone || "UTC";
  const now = DateTime.now().setZone(timezone);

  let start;
  let end;
  let maxResults;

  switch (range) {
    case "today":
      start = now.startOf("day");
      end = now.endOf("day");
      break;

    case "tomorrow":
      start = now.plus({ days: 1 }).startOf("day");
      end = now.plus({ days: 1 }).endOf("day");
      break;

    case "this_week":
      start = now.startOf("week");
      end = now.endOf("week");
      break;

    case "next_week":
      start = now.plus({ weeks: 1 }).startOf("week");
      end = now.plus({ weeks: 1 }).endOf("week");
      break;

    case "this_month":
      start = now.startOf("month");
      end = now.endOf("month");
      break;

    case "next_month":
      start = now.plus({ months: 1 }).startOf("month");
      end = now.plus({ months: 1 }).endOf("month");
      break;

    case "upcoming":
    default:
      start = now;
      end = null;
      maxResults = 10;
      break;
  }

  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: start.toUTC().toISO(),
    ...(end && {
      timeMax: end.toUTC().toISO(),
    }),
    ...(maxResults && {
      maxResults,
    }),
    singleEvents: true,
    orderBy: "startTime",
  });

  return {
    range,
    timezone,
    events: (response.data.items || []).map((event) => ({
      title: event.summary || "Untitled event",
      start:
        event.start?.dateTime ??
        event.start?.date ??
        null,
      end:
        event.end?.dateTime ??
        event.end?.date ??
        null,
    })),
  };
}

export async function getCalendarEventsForDate(date, calendarTimezone) {
  const auth = await getAuthClient();

  const calendar = google.calendar({
    version: "v3",
    auth,
  });

  const timezone = calendarTimezone || (await getPrimaryCalendarTimezone());

  const day = DateTime.fromISO(date, {
    zone: timezone,
  });

  if (!day.isValid) {
    throw new Error("Invalid date");
  }

  const response = await calendar.events.list({
    calendarId: "primary",
    timeMin: day.startOf("day").toUTC().toISO(),
    timeMax: day.endOf("day").toUTC().toISO(),
    singleEvents: true,
    orderBy: "startTime",
  });

  return {
    date,
    timezone,
    events: (response.data.items || []).map((event) => ({
      title: event.summary || "Untitled event",
      start:
        event.start?.dateTime ??
        event.start?.date ??
        null,
      end:
        event.end?.dateTime ??
        event.end?.date ??
        null,
    })),
  };
}
