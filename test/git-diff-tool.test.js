import assert from "node:assert/strict";
import test from "node:test";
import { getGitDiff } from "../public/git-diff-tool.js";

test("sends only the optional project-relative path to the Git diff route", async () => {
  const expectedResult = { success: true, files: [], truncated: false, summary: "No safe current Git changes are available." };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/developer/git-diff");
    assert.deepEqual(options, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "public/app.js" }),
    });
    return { ok: true, json: async () => expectedResult };
  };

  try {
    assert.deepEqual(await getGitDiff("public/app.js"), expectedResult);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normalizes Git diff transport failures", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Network unavailable"); };

  try {
    assert.deepEqual(await getGitDiff(), {
      success: false,
      error: "Could not inspect the project Git diff.",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves normalized terminal path errors from the server", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    json: async () => ({ success: false, error: "path_denied", terminal: true }),
  });

  try {
    assert.deepEqual(await getGitDiff(".env"), {
      success: false,
      error: "path_denied",
      terminal: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
