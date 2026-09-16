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

async function getAuthenticatedCalendar() {
  const auth = await getAuthClient();

  return google.calendar({
    version: "v3",
    auth,
  });
}

async function getCalendarTimezone(calendar) {
  const calendarInfo = await calendar.calendars.get({
    calendarId: "primary",
  });

  return calendarInfo.data.timeZone || "UTC";
}

async function getPrimaryCalendarContext() {
  const calendar = await getAuthenticatedCalendar();
  const timezone = await getCalendarTimezone(calendar);

  return { calendar, timezone };
}

async function listCalendarEvents(calendar, start, end, maxResults) {
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

  return formatCalendarEvents(response.data.items || []);
}

function formatCalendarEvents(calendarEvents) {
  return calendarEvents.map((event) => ({
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

export async function getPrimaryCalendarTimezone() {
  const { timezone } = await getPrimaryCalendarContext();

  return timezone;
}

export async function getCalendarEvents(range = "upcoming") {
  const { calendar, timezone } = await getPrimaryCalendarContext();

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

  const events = await listCalendarEvents(calendar, start, end, maxResults);

  return {
    range,
    timezone,
    events,
  };
}

export async function getCalendarEventsForDate(date, calendarTimezone) {
  const calendar = await getAuthenticatedCalendar();

  const timezone = calendarTimezone || (await getCalendarTimezone(calendar));

  const day = DateTime.fromISO(date, {
    zone: timezone,
  });

  if (!day.isValid) {
    throw new Error("Invalid date");
  }

  const events = await listCalendarEvents(
    calendar,
    day.startOf("day"),
    day.endOf("day")
  );

  return {
    date,
    timezone,
    events,
  };
}
