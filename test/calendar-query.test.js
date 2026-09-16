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
