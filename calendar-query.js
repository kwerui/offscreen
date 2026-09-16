import * as chrono from "chrono-node";
import { DateTime } from "luxon";

const RANGE_BY_QUERY = {
  upcoming: "upcoming",
  today: "today",
  tomorrow: "tomorrow",
  "this week": "this_week",
  "next week": "next_week",
  "this month": "this_month",
  "next month": "next_month",
};

export function parseCalendarQuery(when, referenceDate = new Date(), timezone) {
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
    ? getNextDateForDayOfMonth(
        Number(bareDayMatch[1]),
        referenceDate,
        timezone
      )
    : chrono.parseDate(
        when,
        getChronoReferenceDate(referenceDate, timezone),
        { forwardDate: true }
      );

  if (!parsedDate) {
    return null;
  }

  return {
    type: "date",
    date: formatDate(parsedDate, timezone),
  };
}

function getChronoReferenceDate(referenceDate, timezone) {
  if (!timezone) {
    return referenceDate;
  }

  const calendarReferenceDate = DateTime.fromJSDate(referenceDate).setZone(
    timezone
  );

  return {
    instant: referenceDate,
    timezone: calendarReferenceDate.offset,
  };
}

function getNextDateForDayOfMonth(dayOfMonth, referenceDate, timezone) {
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    return null;
  }

  if (timezone) {
    return getNextDateForDayOfMonthInTimezone(
      dayOfMonth,
      referenceDate,
      timezone
    );
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

function getNextDateForDayOfMonthInTimezone(dayOfMonth, referenceDate, timezone) {
  const today = DateTime.fromJSDate(referenceDate)
    .setZone(timezone)
    .startOf("day");

  for (let monthOffset = 0; monthOffset < 12; monthOffset++) {
    const candidateMonth = today.plus({ months: monthOffset });

    if (dayOfMonth > candidateMonth.daysInMonth) {
      continue;
    }

    const candidate = candidateMonth.set({ day: dayOfMonth });

    if (candidate >= today) {
      return candidate.toJSDate();
    }
  }

  return null;
}

function formatDate(date, timezone) {
  if (timezone) {
    return DateTime.fromJSDate(date).setZone(timezone).toISODate();
  }

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}
