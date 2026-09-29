import assert from "node:assert/strict";
import test from "node:test";
import { getCalendarEvents } from "../public/calendar-tool.js";

async function withMockFetch(mockFetch, runTest) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    await runTest();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("returns the existing Calendar success result shape", async () => {
  await withMockFetch(async (url) => {
    assert.equal(url, "/api/calendar/query?when=today%20and%20tomorrow");

    return {
      ok: true,
      json: async () => ({
        timezone: "America/Cayman",
        events: [{ title: "Demo" }],
      }),
    };
  }, async () => {
    assert.deepEqual(await getCalendarEvents("today and tomorrow"), {
      success: true,
      requested_when: "today and tomorrow",
      timezone: "America/Cayman",
      events: [{ title: "Demo" }],
    });
  });
});

test("returns the existing Calendar HTTP failure result shape", async () => {
  await withMockFetch(async () => ({
    ok: false,
    status: 500,
    text: async () => "Calendar unavailable",
  }), async () => {
    assert.deepEqual(await getCalendarEvents("today"), {
      success: false,
      error: "Calendar request failed with status 500: Calendar unavailable",
    });
  });
});

test("returns the existing Calendar network failure result shape", async () => {
  await withMockFetch(async () => {
    throw new Error("Network unavailable");
  }, async () => {
    assert.deepEqual(await getCalendarEvents("today"), {
      success: false,
      error: "Network unavailable",
    });
  });
});

test("returns the existing Calendar missing-time failure result shape", async () => {
  assert.deepEqual(await getCalendarEvents(""), {
    success: false,
    error: "Calendar time period is required.",
  });
});
