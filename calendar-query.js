import * as chrono from "chrono-node";

const RANGE_BY_QUERY = {
  upcoming: "upcoming",
  today: "today",
  tomorrow: "tomorrow",
  "this week": "this_week",
  "next week": "next_week",
  "this month": "this_month",
  "next month": "next_month",
};

export function parseCalendarQuery(when, referenceDate = new Date()) {
  const normalizedQuery = when.toLowerCase();
  const range = RANGE_BY_QUERY[normalizedQuery];

  if (range) {
    return {
      type: "range",
      range,
    };
  }

  const bareDayMatch = normalizedQuery.match(
    /^(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?$/
  );

  const parsedDate = bareDayMatch
    ? getNextDateForDayOfMonth(Number(bareDayMatch[1]), referenceDate)
    : chrono.parseDate(when, referenceDate, { forwardDate: true });

  if (!parsedDate) {
    return null;
  }

  return {
    type: "date",
    date: formatDate(parsedDate),
  };
}

function getNextDateForDayOfMonth(dayOfMonth, referenceDate) {
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    return null;
  }

  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );

  for (let monthOffset = 0; monthOffset < 12; monthOffset++) {
    const candidate = new Date(
      today.getFullYear(),
      today.getMonth() + monthOffset,
      dayOfMonth
    );

    // JavaScript rolls impossible dates into the next month, so skip them.
    if (candidate.getDate() !== dayOfMonth) {
      continue;
    }

    if (candidate >= today) {
      return candidate;
    }
  }

  return null;
}

function formatDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}
