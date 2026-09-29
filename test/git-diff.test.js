import assert from "node:assert/strict";
import test from "node:test";
import { getGitDiff, parseGitPatch } from "../git-diff.js";

test("parses bounded hunk excerpts and their line totals", () => {
  const parsed = parseGitPatch(
    "diff --git a/public/app.js b/public/app.js\n" +
      "@@ -10,2 +10,3 @@ function run() {\n" +
      "-  oldLine();\n" +
      "+  newLine();\n" +
      "+  anotherLine();\n" +
      " }\n"
  );

  assert.deepEqual(parsed, {
    additions: 2,
    deletions: 1,
    hunks: [{ oldStart: 10, newStart: 10, text: "@@ -10,2 +10,3 @@ function run() {\n-  oldLine();\n+  newLine();\n+  anotherLine();\n }" }],
    truncated: false,
  });
});

test("inspects only fixed staged and unstaged diffs for safe changed files", async () => {
  const calls = [];
  const result = await getGitDiff({
    projectRoot: "/configured/project",
    execFileImpl: async (command, args, options) => {
      calls.push({ command, args, options });
      if (args[0] === "status") {
        return { stdout: "## main\0MM public/app.js\0?? notes.txt\0" };
      }
      if (args.includes("--cached")) {
        return { stdout: "@@ -1 +1 @@\n-old\n+new" };
      }
      return { stdout: "@@ -4 +4 @@\n-before\n+after" };
    },
    getProjectFileImpl: async (_root, path) => ["public/app.js", "notes.txt"].includes(path)
      ? { relativePath: path }
      : null,
  });

  assert.deepEqual(result, {
    success: true,
    files: [{
      path: "public/app.js",
      staged: { status: "modified", additions: 1, deletions: 1, hunks: [{ oldStart: 1, newStart: 1, text: "@@ -1 +1 @@\n-old\n+new" }] },
      unstaged: { status: "modified", additions: 1, deletions: 1, hunks: [{ oldStart: 4, newStart: 4, text: "@@ -4 +4 @@\n-before\n+after" }] },
    }, {
      path: "notes.txt",
      untracked: true,
      diffAvailable: false,
    }],
    truncated: false,
    summary: "1 tracked file with Git diff content and 1 untracked file without a Git diff.",
    presentation: {
      files: [
        { position: 1, path: "public/app.js" },
        { position: 2, path: "notes.txt" },
      ],
      truncated: false,
    },
  });
  assert.deepEqual(calls, [
    { command: "git", args: ["status", "--porcelain=v1", "--branch", "-z"], options: { cwd: "/configured/project", shell: false, timeout: 5000, maxBuffer: 262144 } },
    { command: "git", args: ["diff", "--no-ext-diff", "--no-color", "--no-renames", "--unified=3", "--cached", "--", "public/app.js"], options: { cwd: "/configured/project", shell: false, timeout: 5000, maxBuffer: 262144 } },
    { command: "git", args: ["diff", "--no-ext-diff", "--no-color", "--no-renames", "--unified=3", "--", "public/app.js"], options: { cwd: "/configured/project", shell: false, timeout: 5000, maxBuffer: 262144 } },
  ]);
});

test("rejects an unsafe requested path before invoking Git", async () => {
  const result = await getGitDiff({
    projectRoot: "/configured/project",
    path: "../.env",
    execFileImpl: async () => assert.fail("Git must not run"),
  });

  assert.deepEqual(result, { success: false, error: "invalid_path", terminal: true });
});

test("returns a terminal protected-path result without invoking Git", async () => {
  const result = await getGitDiff({
    projectRoot: "/configured/project",
    path: ".env",
    execFileImpl: async () => assert.fail("Git must not run"),
  });

  assert.deepEqual(result, { success: false, error: "path_denied", terminal: true });
});

test("distinguishes a valid unchanged file from an unavailable path", async () => {
  const result = await getGitDiff({
    projectRoot: "/configured/project",
    path: "public/app.js",
    execFileImpl: async () => ({ stdout: "## main\0" }),
    getProjectFileImpl: async () => ({ relativePath: "public/app.js" }),
  });

  assert.deepEqual(result, { success: false, error: "no_changes", terminal: true });
});

test("does not expose denied files from Git status", async () => {
  const result = await getGitDiff({
    projectRoot: "/configured/project",
    execFileImpl: async () => ({ stdout: "## main\0 M .env\0 M server.js\0" }),
    getProjectFileImpl: async (_root, path) => path === "server.js" ? { relativePath: path } : null,
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.files, [{
    path: "server.js",
    unstaged: { status: "modified", additions: 0, deletions: 0, hunks: [] },
  }]);
});

test("marks a broad result as truncated after its changed-file limit", async () => {
  const statusEntries = Array.from(
    { length: 9 },
    (_value, index) => ` M file-${index}.js\0`
  ).join("");
  const result = await getGitDiff({
    projectRoot: "/configured/project",
    execFileImpl: async (command, args) => args[0] === "status"
      ? { stdout: `## main\0${statusEntries}` }
      : { stdout: "" },
    getProjectFileImpl: async (_root, path) => ({ relativePath: path }),
  });

  assert.equal(result.success, true);
  assert.equal(result.files.length, 8);
  assert.equal(result.truncated, true);
  assert.match(result.truncation, /first 8 changed files/i);
});
