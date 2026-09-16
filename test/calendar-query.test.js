import assert from "node:assert/strict";
import test from "node:test";
import { parseCalendarQuery } from "../calendar-query.js";

const referenceDate = new Date(2026, 0, 15);

test("parses supported named calendar ranges", () => {
  const supportedQueries = {
    upcoming: "upcoming",
    today: "today",
    tomorrow: "tomorrow",
    "this week": "this_week",
    "next week": "next_week",
    "this month": "this_month",
    "next month": "next_month",
  };

  for (const [when, range] of Object.entries(supportedQueries)) {
    assert.deepEqual(parseCalendarQuery(when, referenceDate), {
      type: "range",
      range,
    });
  }
});

test("matches named ranges without regard to letter case", () => {
  assert.deepEqual(parseCalendarQuery("This Week", referenceDate), {
    type: "range",
    range: "this_week",
  });
});

test("uses the next valid occurrence for a bare day-of-month", () => {
  const result = parseCalendarQuery("28th", new Date(2026, 0, 30));

  assert.deepEqual(result, {
    type: "date",
    date: "2026-02-28",
  });
});

test("keeps a bare day-of-month on the current day", () => {
  const result = parseCalendarQuery("on the 28th", new Date(2026, 0, 28));

  assert.deepEqual(result, {
    type: "date",
    date: "2026-01-28",
  });
});

test("skips months that do not contain a requested bare day", () => {
  const result = parseCalendarQuery("31st", new Date(2026, 3, 30));

  assert.deepEqual(result, {
    type: "date",
    date: "2026-05-31",
  });
});

test("parses natural-language dates using a supplied reference date", () => {
  const result = parseCalendarQuery("September 23rd", referenceDate);

  assert.deepEqual(result, {
    type: "date",
    date: "2026-09-23",
  });
});

test("rejects unsupported calendar input", () => {
  assert.equal(parseCalendarQuery("not a date", referenceDate), null);
  assert.equal(parseCalendarQuery("32nd", referenceDate), null);
});

test("keeps named today and tomorrow ranges unchanged with a Calendar timezone", () => {
  const referenceInstant = new Date("2026-01-01T01:30:00Z");
  const calendarTimezone = "Pacific/Auckland";

  assert.deepEqual(
    parseCalendarQuery("today", referenceInstant, calendarTimezone),
    { type: "range", range: "today" }
  );
  assert.deepEqual(
    parseCalendarQuery("tomorrow", referenceInstant, calendarTimezone),
    { type: "range", range: "tomorrow" }
  );
});

test("uses the Calendar timezone when resolving a weekday", () => {
  // At this instant it is Thursday in America/Cayman but Friday in Auckland.
  const referenceInstant = new Date("2026-01-02T01:30:00Z");

  assert.deepEqual(
    parseCalendarQuery("Friday", referenceInstant, "Pacific/Auckland"),
    {
      type: "date",
      date: "2026-01-09",
    }
  );
});

test("uses the Calendar timezone when resolving a bare ordinal date", () => {
  // At this instant it is the 28th in America/Cayman but the 29th in Auckland.
  const referenceInstant = new Date("2026-01-29T01:30:00Z");

  assert.deepEqual(
    parseCalendarQuery("28th", referenceInstant, "Pacific/Auckland"),
    {
      type: "date",
      date: "2026-02-28",
    }
  );
});

test("uses the Calendar timezone when resolving a natural-language date", () => {
  // At this instant it is still December 31 in America/Cayman but January 1
  // in Auckland, so the next January 1 is in 2027 for that Calendar.
  const referenceInstant = new Date("2026-01-01T01:30:00Z");

  assert.deepEqual(
    parseCalendarQuery("January 1st", referenceInstant, "Pacific/Auckland"),
    {
      type: "date",
      date: "2027-01-01",
    }
  );
});
