import assert from "node:assert/strict";
import test from "node:test";
import { getCommitDiff, getGitHistory, parseGitHistory } from "../git-history.js";

test("returns bounded newest-first recent commits from a fixed Git log command", async () => {
  const calls = [];
  const result = await getGitHistory({
    projectRoot: "/configured/project",
    execFileImpl: async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: "a".repeat(40) + "\u001faaaaaaa\u001fNewest change\u001fAda\u001f2026-01-02T03:04:05+00:00\u001f" + "b".repeat(40) + "\u001e" };
    },
  });

  assert.deepEqual(result.commits, [{
    id: "a".repeat(40), shortId: "aaaaaaa", subject: "Newest change", author: "Ada",
    authoredAt: "2026-01-02T03:04:05+00:00", parentCount: 1, position: 1,
  }]);
  assert.deepEqual(calls, [{
    command: "git",
    args: ["log", "-n", "5", "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%P%x1e"],
    options: { cwd: "/configured/project", shell: false, timeout: 5000, maxBuffer: 65536 },
  }]);
});

test("parses all five Git records when Git places newlines after record separators", () => {
  const output = Array.from({ length: 5 }, (_value, index) => (
    `${String(index + 1).repeat(40)}\u001f${index + 1}\u001fCommit ${index + 1}\u001fAda\u001f2026-01-02T03:04:05+00:00\u001f${"a".repeat(40)}\u001e\n`
  )).join("");
  assert.deepEqual(parseGitHistory(output).map((commit) => commit.subject), [
    "Commit 1", "Commit 2", "Commit 3", "Commit 4", "Commit 5",
  ]);
});

test("clamps history requests to a small hard maximum", async () => {
  const calls = [];
  await getGitHistory({ projectRoot: "/configured/project", limit: 999, execFileImpl: async (_command, args) => {
    calls.push(args); return { stdout: "" };
  } });
  assert.deepEqual(calls, [["log", "-n", "10", "--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%P%x1e"]]);
});

test("parses only complete bounded commit metadata records", () => {
  assert.deepEqual(parseGitHistory("bad\u001e"), []);
  assert.deepEqual(parseGitHistory("a".repeat(40) + "\u001fx\u001fSubject\u001fAuthor\u001fdate\u001f\u001e"), [{
    id: "a".repeat(40), shortId: "x", subject: "Subject", author: "Author", authoredAt: "date", parentCount: 0, position: 1,
  }]);
});

test("normalizes empty history and Git failures", async () => {
  assert.deepEqual(await getGitHistory({ projectRoot: "/configured/project", execFileImpl: async () => ({ stdout: "" }) }), {
    success: false, error: "This repository has no commits yet.", terminal: true,
  });
  assert.deepEqual(await getGitHistory({ projectRoot: "/configured/project", execFileImpl: async () => { throw new Error("timeout"); } }), {
    success: false, error: "Could not inspect the recent project Git history.",
  });
});

test("inspects only an established full immutable commit ID with fixed commands", async () => {
  const calls = [];
  const id = "a".repeat(40);
  const result = await getCommitDiff({ projectRoot: "/configured/project", commit: { id, shortId: "aaaaaaa", subject: "A change", author: "Ada", authoredAt: "date", parentCount: 1 }, execFileImpl: async (command, args, options) => {
    calls.push({ command, args, options });
    if (args.includes("--name-status")) return { stdout: "M\u0000public/app.js\u0000" };
    return { stdout: "@@ -1 +1 @@\n-old\n+new\n" };
  } });
  assert.equal(result.success, true);
  assert.deepEqual(result.files, [{ path: "public/app.js", status: "modified", additions: 1, deletions: 1, hunks: [{ oldStart: 1, newStart: 1, text: "@@ -1 +1 @@\n-old\n+new" }] }]);
  assert.deepEqual(calls.map(({ args }) => args), [
    ["show", "--format=", "--no-ext-diff", "--no-color", "--no-renames", "--name-status", "-z", id, "--"],
    ["show", "--format=", "--no-ext-diff", "--no-color", "--no-renames", "--unified=3", id, "--", "public/app.js"],
  ]);
});

test("rejects malformed and flag-like references before Git", async () => {
  for (const id of ["HEAD~1", "--all"]) {
    const result = await getCommitDiff({ projectRoot: "/configured/project", commit: { id }, execFileImpl: async () => assert.fail("Git must not run") });
    assert.deepEqual(result, { success: false, error: "commit_unavailable", terminal: true });
  }
  const merge = await getCommitDiff({ projectRoot: "/configured/project", commit: { id: "a".repeat(40), parentCount: 2 }, execFileImpl: async () => assert.fail("Git must not run") });
  assert.deepEqual(merge, { success: false, error: "merge_unsupported", terminal: true });
});

test("supports a root commit and marks a broad commit diff as truncated", async () => {
  const id = "c".repeat(40);
  const names = Array.from({ length: 9 }, (_value, index) => `M\u0000file-${index}.js\u0000`).join("");
  const result = await getCommitDiff({
    projectRoot: "/configured/project",
    commit: { id, shortId: "ccccccc", subject: "Initial commit", parentCount: 0 },
    execFileImpl: async (_command, args) => args.includes("--name-status")
      ? { stdout: names }
      : { stdout: "@@ -1 +1 @@\n+root\n" },
  });
  assert.equal(result.success, true);
  assert.equal(result.files.length, 8);
  assert.equal(result.truncated, true);
  assert.match(result.truncation, /first 8 safe changed files/i);
});
