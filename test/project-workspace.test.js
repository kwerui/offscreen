import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createVoiceSearchVariants,
  readProjectFile,
  searchProject,
} from "../project-workspace.js";

async function createProjectFixture() {
  const projectRoot = await mkdtemp(join(tmpdir(), "offscreen-project-workspace-"));

  await mkdir(join(projectRoot, "public"));
  await mkdir(join(projectRoot, "node_modules", "package"), { recursive: true });
  await mkdir(join(projectRoot, ".git"));
  await writeFile(join(projectRoot, "public", "app.js"), [
    "const pendingBrowserConfirmation = true;",
    "function confirmBrowserAction() {}",
    "const literal = 'a.b';",
  ].join("\n"));
  await writeFile(join(projectRoot, "another.js"), "const pendingBrowserConfirmation = false;");
  await writeFile(join(projectRoot, "project-tests.js"), "export function runProjectTests() {}\n");
  await writeFile(join(projectRoot, "project-tests-tool.js"), "export const projectTestsTool = true;\n");
  await writeFile(join(projectRoot, "session.js"), "const event = 'session.updated';\n");
  await writeFile(join(projectRoot, "notes with ünicode.txt"), "first\nsecond\nthird\nfourth\n");
  await writeFile(join(projectRoot, ".env"), "SECRET=value");
  await writeFile(join(projectRoot, ".env.local"), "SECRET=value");
  await writeFile(join(projectRoot, ".npmrc"), "//registry.example/:_authToken=secret");
  await writeFile(join(projectRoot, ".netrc"), "machine example login user password secret");
  await writeFile(join(projectRoot, ".pypirc"), "[distutils]");
  await writeFile(join(projectRoot, ".envrc"), "export SECRET=value");
  await writeFile(join(projectRoot, "credentials.json"), "secret");
  await writeFile(join(projectRoot, "token.json"), "secret");
  await writeFile(join(projectRoot, "private.key"), "secret");
  await writeFile(join(projectRoot, "node_modules", "package", "index.js"), "pendingBrowserConfirmation");
  await writeFile(join(projectRoot, ".git", "config"), "pendingBrowserConfirmation");
  await writeFile(join(projectRoot, "binary.dat"), Buffer.from([0, 1, 2, 3]));

  const outsideRoot = await mkdtemp(join(tmpdir(), "offscreen-outside-"));
  await writeFile(join(outsideRoot, "outside.txt"), "pendingBrowserConfirmation");
  await symlink(join(outsideRoot, "outside.txt"), join(projectRoot, "outside-link.txt"));

  return { projectRoot, outsideRoot };
}

async function withProjectFixture(runTest) {
  const fixture = await createProjectFixture();

  try {
    await runTest(fixture);
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
    await rm(fixture.outsideRoot, { recursive: true, force: true });
  }
}

test("searches literal text and paths without interpreting regex", async () => {
  await withProjectFixture(async ({ projectRoot }) => {
    const contentResult = await searchProject({ projectRoot, query: "pendingBrowserConfirmation" });
    const pathResult = await searchProject({ projectRoot, query: "app.js" });
    const literalResult = await searchProject({ projectRoot, query: "a.b" });

    assert.equal(contentResult.success, true);
    const appMatch = contentResult.matches.find((match) => match.path === "public/app.js");
    assert.equal(appMatch.line, 1);
    assert.equal(new Set(contentResult.matches.map((match) => match.path)).size, 2);
    assert.deepEqual(contentResult.files, [
      { path: "another.js", firstLine: 1 },
      { path: "public/app.js", firstLine: 1 },
    ]);
    assert.deepEqual(contentResult.presentation, {
      files: [
        { position: 1, path: "another.js" },
        { position: 2, path: "public/app.js" },
      ],
      truncated: false,
    });
    assert.equal(pathResult.matches[0].path, "public/app.js");
    assert.equal(pathResult.matches[0].line, undefined);
    assert.deepEqual(pathResult.files, [{ path: "public/app.js" }]);
    assert.equal(literalResult.matches.length, 1);
    assert.match(literalResult.matches[0].snippet, /a\.b/);
  });
});

test("normalizes bounded spoken search tokens without synthesizing paths", async () => {
  assert.deepEqual(createVoiceSearchVariants("run project tests"), [
    "runProjectTests",
    "run-project-tests",
    "run_project_tests",
    "run.project.tests",
    "run project tests",
  ]);
  assert.deepEqual(createVoiceSearchVariants("app js"), [
    "appJs", "app-js", "app_js", "app.js", "app js",
  ]);
  assert.deepEqual(createVoiceSearchVariants("one two three four five six seven"), [
    "one two three four five six seven",
  ]);
  assert.deepEqual(createVoiceSearchVariants("../outside"), ["../outside"]);
  assert.ok(createVoiceSearchVariants("run project tests").every((variant) => !variant.includes("/")));
});

test("finds spoken developer-search forms while preserving literal search", async () => {
  await withProjectFixture(async ({ projectRoot }) => {
    for (const [query, expectedPath] of [
      ["run project tests", "project-tests.js"],
      ["project tests tool", "project-tests-tool.js"],
      ["session updated", "session.js"],
      ["app js", "public/app.js"],
    ]) {
      const result = await searchProject({ projectRoot, query });
      assert.ok(result.matches.some((match) => match.path === expectedPath), query);
      assert.ok(result.files.some((file) => file.path === expectedPath), query);
    }

    const literalResult = await searchProject({ projectRoot, query: "a.b" });
    assert.equal(literalResult.matches.length, 1);
  });
});

test("search bounds matches and snippets while ignoring denied, binary, and symlinked files", async () => {
  await withProjectFixture(async ({ projectRoot }) => {
    await writeFile(join(projectRoot, "many.txt"), Array.from({ length: 80 }, () => "needle").join("\n"));
    await writeFile(join(projectRoot, "long.txt"), `needle${"x".repeat(1_000)}`);

    const result = await searchProject({ projectRoot, query: "needle" });
    const excludedResult = await searchProject({ projectRoot, query: "pendingBrowserConfirmation" });
    const sensitiveResult = await searchProject({ projectRoot, query: "secret" });
    const longSnippetResult = await searchProject({ projectRoot, query: "x".repeat(20) });

    assert.equal(result.success, true);
    assert.equal(result.truncated, true);
    assert.ok(result.matches.length <= 50);
    assert.ok(longSnippetResult.matches.every((match) => !match.snippet || match.snippet.length <= 240));
    assert.equal(excludedResult.matches.some((match) => /node_modules|\.git|outside-link/.test(match.path)), false);
    assert.equal(sensitiveResult.matches.length, 0);
  });
});

test("rejects empty and oversized search queries", async () => {
  await withProjectFixture(async ({ projectRoot }) => {
    assert.deepEqual(await searchProject({ projectRoot, query: "" }), {
      success: false,
      error: "Search query is required.",
    });
    assert.deepEqual(await searchProject({ projectRoot, query: "x".repeat(201) }), {
      success: false,
      error: "Search query is too long.",
    });
  });
});

test("reads bounded project-relative text ranges with exact source content", async () => {
  await withProjectFixture(async ({ projectRoot }) => {
    const ranged = await readProjectFile({
      projectRoot,
      path: "notes with ünicode.txt",
      startLine: 2,
      endLine: 3,
    });
    const defaultRange = await readProjectFile({ projectRoot, path: "notes with ünicode.txt" });

    assert.deepEqual(ranged, {
      success: true,
      path: "notes with ünicode.txt",
      startLine: 2,
      endLine: 3,
      totalLines: 4,
      content: "second\nthird",
      truncated: true,
    });
    assert.equal(defaultRange.content, "first\nsecond\nthird\nfourth");
    assert.equal(defaultRange.truncated, false);

    await writeFile(join(projectRoot, "windows.txt"), "one\r\ntwo\r\nthree");
    const windowsRange = await readProjectFile({
      projectRoot,
      path: "windows.txt",
      startLine: 1,
      endLine: 2,
    });
    assert.equal(windowsRange.content, "one\r\ntwo");
  });
});

test("rejects unsafe, invalid, and non-text read targets", async () => {
  await withProjectFixture(async ({ projectRoot }) => {
    for (const path of [
      "/etc/passwd",
      "C:\\Users\\someone\\secret.txt",
      "C:/Users/someone/secret.txt",
      "\\\\server\\share\\secret.txt",
      "../outside.txt",
      "outside-link.txt",
      "binary.dat",
      ".env",
      ".npmrc",
      ".netrc",
      ".pypirc",
      ".envrc",
      "credentials.json",
      "node_modules/package/index.js",
      "public",
    ]) {
      const result = await readProjectFile({ projectRoot, path });
      assert.equal(result.success, false, path);
      assert.doesNotMatch(result.error, /\/|\.env|credential|node_modules/i);
    }

    assert.deepEqual(await readProjectFile({ projectRoot, path: "public/app.js", startLine: 2, endLine: 1 }), {
      success: false,
      error: "The requested line range is invalid.",
    });
    assert.deepEqual(await readProjectFile({ projectRoot, path: "public/app.js", startLine: 1, endLine: 202 }), {
      success: false,
      error: "The requested line range is too large.",
    });
    assert.deepEqual(await readProjectFile({ projectRoot, path: "public/app.js", startLine: 99, endLine: 99 }), {
      success: false,
      error: "The requested line range is invalid.",
    });
  });
});
