import assert from "node:assert/strict";
import test from "node:test";
import { runCodexTask } from "../public/codex-tool.js";

async function withMockFetch(mockFetch, runTest) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    await runTest();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("returns the existing Codex success result shape", async () => {
  await withMockFetch(async (url, options) => {
    assert.equal(url, "/api/codex");
    assert.deepEqual(options, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ task: "Explain this project." }),
    });

    return {
      ok: true,
      json: async () => ({ output: "Offscreen is voice-first." }),
    };
  }, async () => {
    assert.deepEqual(await runCodexTask("Explain this project."), {
      success: true,
      output: "Offscreen is voice-first.",
    });
  });
});

test("returns the existing Codex HTTP failure result shape", async () => {
  await withMockFetch(async () => ({
    ok: false,
    status: 500,
    text: async () => "Codex unavailable",
  }), async () => {
    assert.deepEqual(await runCodexTask("Inspect the project."), {
      success: false,
      error: "Codex request failed with status 500: Codex unavailable",
    });
  });
});

test("returns the existing Codex network failure result shape", async () => {
  await withMockFetch(async () => {
    throw new Error("Network unavailable");
  }, async () => {
    assert.deepEqual(await runCodexTask("Inspect the project."), {
      success: false,
      error: "Network unavailable",
    });
  });
});

test("returns the existing Codex empty-task failure result shape", async () => {
  assert.deepEqual(await runCodexTask(""), {
    success: false,
    error: "Codex task is required.",
  });
});

test("returns the existing Codex missing-task failure result shape", async () => {
  assert.deepEqual(await runCodexTask(), {
    success: false,
    error: "Codex task is required.",
  });
});
