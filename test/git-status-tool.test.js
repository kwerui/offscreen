import assert from "node:assert/strict";
import test from "node:test";
import { getGitStatus } from "../public/git-status-tool.js";

async function withMockFetch(mockFetch, runTest) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    await runTest();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("requests Git status without user or model-controlled input", async () => {
  const expectedResult = {
    success: true,
    branch: "main",
    clean: false,
    staged: [],
    unstaged: [{ path: "server.js", status: "modified" }],
    untracked: [],
    summary: "1 unstaged file.",
  };

  await withMockFetch(async (url, options) => {
    assert.equal(url, "/api/developer/git-status");
    assert.deepEqual(options, { method: "POST" });
    return { ok: true, json: async () => expectedResult };
  }, async () => {
    assert.deepEqual(await getGitStatus(), expectedResult);
  });
});

test("normalizes HTTP and network failures", async () => {
  await withMockFetch(async () => ({
    ok: false,
    json: async () => ({ error: "internal detail" }),
  }), async () => {
    assert.deepEqual(await getGitStatus(), {
      success: false,
      error: "Could not inspect the project Git status.",
    });
  });

  await withMockFetch(async () => {
    throw new Error("Network unavailable");
  }, async () => {
    assert.deepEqual(await getGitStatus(), {
      success: false,
      error: "Could not inspect the project Git status.",
    });
  });
});
