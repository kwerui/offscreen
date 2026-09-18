import assert from "node:assert/strict";
import test from "node:test";
import { getGitStatus, parseGitStatus } from "../git-status.js";

test("parses a clean repository and its branch", () => {
  assert.deepEqual(parseGitStatus("## refactor/project-structure\0"), {
    branch: "refactor/project-structure",
    clean: true,
    staged: [],
    unstaged: [],
    untracked: [],
    summary: "Working tree is clean on refactor/project-structure.",
  });
});

test("parses staged, unstaged, and untracked file entries", () => {
  const result = parseGitStatus(
    "## main...origin/main [ahead 1]\0" +
      "A  staged.js\0" +
      " M modified.js\0" +
      "?? untracked.js\0"
  );

  assert.equal(result.branch, "main");
  assert.deepEqual(result.staged, [{ path: "staged.js", status: "added" }]);
  assert.deepEqual(result.unstaged, [{ path: "modified.js", status: "modified" }]);
  assert.deepEqual(result.untracked, [{ path: "untracked.js", status: "untracked" }]);
  assert.equal(result.clean, false);
  assert.equal(
    result.summary,
    "1 staged file, 1 unstaged file, and 1 untracked file."
  );
});

test("parses mixed status entries and deleted files", () => {
  const result = parseGitStatus(
    "## main\0" +
      "MM changed-twice.js\0" +
      " D removed.js\0" +
      "?? notes.txt\0"
  );

  assert.deepEqual(result.staged, [{ path: "changed-twice.js", status: "modified" }]);
  assert.deepEqual(result.unstaged, [
    { path: "changed-twice.js", status: "modified" },
    { path: "removed.js", status: "deleted" },
  ]);
  assert.deepEqual(result.untracked, [{ path: "notes.txt", status: "untracked" }]);
});

test("preserves both paths for a staged rename", () => {
  const result = parseGitStatus("## main\0R  new-name.js\0old-name.js\0");

  assert.deepEqual(result.staged, [
    { path: "new-name.js", originalPath: "old-name.js", status: "renamed" },
  ]);
});

test("runs only the fixed read-only Git command in the configured project root", async () => {
  const calls = [];
  const result = await getGitStatus({
    projectRoot: "/configured/project",
    execFileImpl: async (command, args, options) => {
      calls.push({ command, args, options });
      return { stdout: "## main\0", stderr: "" };
    },
  });

  assert.equal(result.success, true);
  assert.deepEqual(calls, [{
    command: "git",
    args: ["status", "--porcelain=v1", "--branch", "-z"],
    options: { cwd: "/configured/project", maxBuffer: 64 * 1024 },
  }]);
});

test("normalizes Git command failures without returning process details", async () => {
  const result = await getGitStatus({
    projectRoot: "/configured/project",
    execFileImpl: async () => {
      throw new Error("fatal: sensitive implementation detail");
    },
  });

  assert.deepEqual(result, {
    success: false,
    error: "Could not inspect the project Git status.",
  });
});
