import assert from "node:assert/strict";
import test from "node:test";
import { createCommitReferenceContext } from "../public/commit-reference-context.js";

test("resolves ordinals only from commits actually spoken", () => {
  const context = createCommitReferenceContext();
  context.registerHistory({ success: true, commits: [
    { reference: "one", shortId: "111", subject: "First change" },
    { reference: "two", shortId: "222", subject: "Second change" },
    { reference: "three", shortId: "333", subject: "Hidden change" },
  ] });
  context.markPendingHistoryReady();
  context.alignPendingHistory("Your commits are Second change, then First change.");
  assert.deepEqual(context.resolve({ position: 2 }, "What changed in the second commit?"), { success: true, reference: "one" });
  assert.deepEqual(context.resolve({ position: 3 }, "What changed in the third commit?"), { success: false, error: "I can inspect only a commit from the recent list you heard. Ask me to refresh the recent commits." });
});

test("a refreshed spoken history deliberately replaces prior commit ordinals", () => {
  const context = createCommitReferenceContext();
  for (const [reference, subject] of [["old", "Old commit"], ["new", "New commit"]]) {
    context.registerHistory({ success: true, commits: [{ reference, subject }] });
    context.markPendingHistoryReady();
    context.alignPendingHistory(subject);
  }
  assert.deepEqual(context.resolve({ position: 1 }, "What changed in the latest commit?"), { success: true, reference: "new" });
});

test("keeps three explicitly spoken commits available in their spoken order", () => {
  const context = createCommitReferenceContext();
  context.registerHistory({ success: true, commits: [
    { reference: "one", subject: "First" }, { reference: "two", subject: "Second" }, { reference: "three", subject: "Third" },
  ] });
  context.markPendingHistoryReady();
  context.alignPendingHistory("Your three commits are First, Second, and Third.");
  assert.deepEqual(context.resolve({ position: 2 }, "What changed in the second commit?"), { success: true, reference: "two" });
  assert.deepEqual(context.resolve({ position: 3 }, "What changed in the third commit?"), { success: true, reference: "three" });
});
