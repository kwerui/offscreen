import assert from "node:assert/strict";
import test from "node:test";
import { runBrowserTool } from "../public/browser-tool.js";

async function withMockFetch(mockFetch, runTest) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    await runTest();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("returns the browser API success result", async () => {
  await withMockFetch(async (url, options) => {
    assert.equal(url, "/api/browser");
    assert.deepEqual(JSON.parse(options.body), {
      action: "find",
      text: "Welcome",
    });
    return {
      ok: true,
      json: async () => ({ success: true, content: "Welcome" }),
    };
  }, async () => {
    assert.deepEqual(await runBrowserTool("find", { text: "Welcome" }), {
      success: true,
      content: "Welcome",
    });
  });
});

test("returns a normalized browser API failure", async () => {
  await withMockFetch(async () => ({
    ok: false,
    json: async () => ({ success: false, error: "Unsupported browser action" }),
  }), async () => {
    assert.deepEqual(await runBrowserTool("click", {}), {
      success: false,
      error: "Unsupported browser action",
    });
  });
});

test("preserves safe browser confirmation results", async () => {
  await withMockFetch(async () => ({
    ok: false,
    json: async () => ({
      success: false,
      confirmation_required: true,
      error: "Confirmation is required before this browser action.",
      errorCode: "browser_confirmation_required",
      description: "Delete this item",
    }),
  }), async () => {
    assert.deepEqual(await runBrowserTool("click", { target: "e12" }), {
      success: false,
      confirmation_required: true,
      error: "Confirmation is required before this browser action.",
      errorCode: "browser_confirmation_required",
      description: "Delete this item",
    });
  });
});
