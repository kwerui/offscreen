export async function getCalendarEvents(when) {
  try {
    if (!when) {
      throw new Error(
        "Calendar time period is required."
      );
    }

    console.log("Calendar tool started");

    const response = await fetch(
      `/api/calendar/query?when=${encodeURIComponent(when)}`
    );

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(
        `Calendar request failed with status ${response.status}: ${errorText}`
      );
    }

    const data = await response.json();

    console.log(
      `Calendar tool completed: ${(data.events || []).length} events`
    );

    return {
      success: true,
      requested_when: when,
      timezone: data.timezone,
      events: data.events || [],
    };
  } catch (err) {
    console.error("Calendar tool failed");

    return {
      success: false,
      error: err.message,
    };
  }
}
