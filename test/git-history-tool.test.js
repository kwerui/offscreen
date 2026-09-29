import assert from "node:assert/strict";
import test from "node:test";
import { getCommitDiff, getGitHistory } from "../public/git-history-tool.js";

test("requests history without model-controlled input and commit diffs with only an opaque reference", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ success: true, commits: [] }) };
  };
  try {
    await getGitHistory();
    await getCommitDiff("opaque-reference");
    assert.deepEqual(requests, [
      { url: "/api/developer/git-history", options: { method: "POST" } },
      { url: "/api/developer/commit-diff", options: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference: "opaque-reference" }) } },
    ]);
  } finally { globalThis.fetch = originalFetch; }
});

test("preserves every bounded history entry returned by the server", async () => {
  const originalFetch = globalThis.fetch;
  const expected = { success: true, commits: [
    { position: 1, subject: "First" }, { position: 2, subject: "Second" }, { position: 3, subject: "Third" },
  ] };
  globalThis.fetch = async () => ({ ok: true, json: async () => expected });
  try { assert.deepEqual(await getGitHistory(), expected); } finally { globalThis.fetch = originalFetch; }
});
