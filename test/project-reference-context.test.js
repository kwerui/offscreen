import assert from "node:assert/strict";
import test from "node:test";
import { createProjectReferenceContext } from "../public/project-reference-context.js";

test("binds search ordinals to the file paths actually spoken, in spoken order", () => {
  const context = createProjectReferenceContext();
  context.registerResult("search_project", { success: true, query: "runProjectTests", files: [
    { path: "project-tests.js", firstLine: 271 },
    { path: "public/app.js", firstLine: 37 },
    { path: "public/project-tests-tool.js", firstLine: 1 },
    { path: "server.js", firstLine: 40 },
  ], presentation: { files: [
    { position: 1, path: "project-tests.js" },
    { position: 2, path: "public/app.js" },
    { position: 3, path: "public/project-tests-tool.js" },
    { position: 4, path: "server.js" },
  ] } });

  context.markPendingSearchResultReady();
  assert.equal(context.alignPendingSearchResult(
    "The most relevant files seem to be project-tests.js, public/project-tests-tool.js, and server.js."
  ), true);

  for (const [ordinal, path] of [
    ["first", "project-tests.js"],
    ["second", "public/project-tests-tool.js"],
    ["third", "server.js"],
  ]) {
    assert.deepEqual(context.resolve({
      toolName: "open_project_file",
      arguments: { path: `${ordinal} one` },
      userText: `Open the ${ordinal} one.`,
    }), {
      success: true,
      arguments: { path },
    });
  }

  // public/app.js was in the hidden candidate list but was not spoken, so it
  // cannot consume an ordinal after the response is complete.
  assert.equal(context.resolve({
    toolName: "open_project_file",
    arguments: { path: "fourth one" },
    userText: "Open the fourth one.",
  }).success, false);
});

test("waits until the search tool result was sent before aligning an agent reply", () => {
  const context = createProjectReferenceContext();
  context.registerResult("search_project", { success: true, query: "tool", presentation: { files: [
    { position: 1, path: "a.js" },
    { position: 2, path: "b.js" },
  ] } });

  // A pre-tool utterance such as "I'll search for that" must not consume the
  // pending search result before AssemblyAI has actually received it.
  assert.equal(context.alignPendingSearchResult("I'll search for that."), false);
  context.markPendingSearchResultReady();
  assert.equal(context.alignPendingSearchResult("I found b.js, then a.js."), true);
  assert.deepEqual(context.resolve({
    toolName: "open_project_file",
    arguments: { path: "first one" },
    userText: "Open the first one.",
  }).arguments, { path: "b.js" });
});

test("keeps explicit ordinals attached to the latest list after opening one item", () => {
  const context = createProjectReferenceContext();
  context.registerResult("search_project", { success: true, query: "tool", presentation: { files: [
    { position: 1, path: "a.js" },
    { position: 2, path: "b.js" },
    { position: 3, path: "c.js" },
  ] } });
  context.markPendingSearchResultReady();
  context.alignPendingSearchResult("I found a.js, b.js, and c.js.");

  assert.deepEqual(context.resolve({
    toolName: "open_project_file",
    arguments: { path: "second one" },
    userText: "Open the second one.",
  }).arguments, { path: "b.js" });

  context.registerResult("open_project_file", { success: true, path: "b.js" });

  // A successful open becomes the deictic "it", but must not replace the
  // list that first/second/third refer to.
  assert.deepEqual(context.resolve({
    toolName: "open_project_file",
    arguments: { path: "it" },
    userText: "Open it at line 120.",
  }).arguments, { path: "b.js", line: 120 });
  assert.deepEqual(context.resolve({
    toolName: "open_project_file",
    arguments: { path: "third one" },
    userText: "Open the third one.",
  }).arguments, { path: "c.js" });
});

test("uses an explicit spoken line with a contextual file but never a match line", () => {
  const context = createProjectReferenceContext();
  context.registerResult("search_project", { success: true, query: "tool", presentation: { files: [
    { position: 1, path: "public/project-tests-tool.js" },
  ] } });
  context.markPendingSearchResultReady();
  context.alignPendingSearchResult("I found public/project-tests-tool.js.");

  assert.deepEqual(context.resolve({
    toolName: "open_project_file",
    arguments: { path: "that file", line: 1 },
    userText: "Open that file.",
  }).arguments, { path: "public/project-tests-tool.js" });
  assert.deepEqual(context.resolve({
    toolName: "open_project_file",
    arguments: { path: "that file" },
    userText: "Open it at line 120.",
  }).arguments, { path: "public/project-tests-tool.js", line: 120 });
});

test("does not keep unspoken search files as hidden references", () => {
  const context = createProjectReferenceContext();
  context.registerResult("search_project", { success: true, query: "thing", presentation: { files: [
    { position: 1, path: "a.js" },
    { position: 2, path: "b.js" },
  ] } });

  context.markPendingSearchResultReady();
  context.alignPendingSearchResult("I found several matches in the project.");
  assert.equal(context.resolve({
    toolName: "open_project_file",
    arguments: { path: "first one" },
    userText: "Open the first one.",
  }).success, false);
  assert.deepEqual(context.resolve({
    toolName: "search_project",
    arguments: { query: "that query" },
    userText: "Search for that query.",
  }).arguments, { query: "thing" });
});

test("resolves a unique reference but does not guess an ambiguous one", () => {
  const context = createProjectReferenceContext();
  context.registerResult("read_project_file", { success: true, path: "public/app.js", startLine: 1 });
  assert.deepEqual(context.resolve({ toolName: "read_project_file", arguments: { path: "that file" }, userText: "Read that file." }), {
    success: true, arguments: { path: "public/app.js" },
  });

  context.registerResult("search_project", { success: true, query: "thing", matches: [{ path: "a.js" }, { path: "b.js" }] });
  context.markPendingSearchResultReady();
  context.alignPendingSearchResult("I found a.js and b.js.");
  assert.equal(context.resolve({ toolName: "open_project_file", arguments: { path: "that file" }, userText: "Open that file." }).success, false);
});

test("registers Git and test-failure locations while rejecting unsafe paths", () => {
  const context = createProjectReferenceContext();
  context.registerResult("get_git_status", { success: true, staged: [{ path: ".env" }, { path: "private.key" }], unstaged: [{ path: "server.js" }], untracked: [] });
  assert.deepEqual(context.resolve({ toolName: "open_project_file", arguments: { path: "that file" }, userText: "Open that file." }).arguments, { path: "server.js" });

  context.clear();
  context.registerResult("run_project_tests", { success: true, failures: [{ file: "test/app.test.js:12:3" }, { file: "/etc/passwd:1:1" }] });
  assert.deepEqual(context.resolve({ toolName: "open_project_file", arguments: { path: "the file with that failure" }, userText: "Open the file with that failure." }).arguments, { path: "test/app.test.js", line: 12 });
});

test("binds Git diff ordinals to the changed files actually spoken", () => {
  const context = createProjectReferenceContext();
  context.registerResult("get_git_diff", { success: true, files: [
    { path: "public/app.js", unstaged: { hunks: [] } },
    { path: "server.js", staged: { hunks: [] } },
    { path: ".env", unstaged: { hunks: [] } },
  ], presentation: { files: [
    { position: 1, path: "public/app.js" },
    { position: 2, path: "server.js" },
  ] } });
  context.markPendingSearchResultReady();
  context.alignPendingSearchResult("You changed server.js, then public/app.js.");

  assert.deepEqual(context.resolve({
    toolName: "open_project_file",
    arguments: { path: "second changed file" },
    userText: "Open the second changed file.",
  }).arguments, { path: "public/app.js" });
  assert.deepEqual(context.resolve({
    toolName: "get_git_diff",
    arguments: { path: "first one" },
    userText: "What changed in the first one?",
  }).arguments, { path: "server.js" });
});

test("does not let a file-specific Git diff replace the broad changed-file list", () => {
  const context = createProjectReferenceContext();
  context.registerResult("get_git_diff", { success: true, presentation: { files: [
    { position: 1, path: "a.js" },
    { position: 2, path: "b.js" },
  ] } });
  context.markPendingSearchResultReady();
  context.alignPendingSearchResult("The changed files are a.js and b.js.");

  context.registerResult("get_git_diff", { success: true, files: [{ path: "a.js" }] });
  assert.deepEqual(context.resolve({
    toolName: "open_project_file",
    arguments: { path: "second changed file" },
    userText: "Open the second changed file.",
  }).arguments, { path: "b.js" });
});

test("binds commit-diff changed files to spoken current-file references", () => {
  const context = createProjectReferenceContext();
  context.registerResult("get_commit_diff", { success: true, presentation: { files: [
    { position: 1, path: "public/app.js" }, { position: 2, path: "server.js" },
  ] } });
  context.markPendingSearchResultReady();
  context.alignPendingSearchResult("The commit changed server.js and public/app.js.");
  assert.deepEqual(context.resolve({ toolName: "open_project_file", arguments: { path: "second changed file" }, userText: "Open the second changed file." }).arguments, { path: "public/app.js" });
});

test("uses a prior safe search query, bounds storage, and clears on reset", () => {
  const context = createProjectReferenceContext();
  for (let index = 0; index < 25; index++) {
    context.registerResult("search_project", { success: true, query: `needle${index}`, matches: [{ path: `file${index}.js` }] });
    context.markPendingSearchResultReady();
    context.alignPendingSearchResult(`I found file${index}.js.`);
  }
  assert.equal(context.size, 20);
  assert.deepEqual(context.resolve({ toolName: "search_project", arguments: { query: "that function" }, userText: "Search for that function." }).arguments, { query: "needle24" });
  context.clear();
  assert.equal(context.resolve({ toolName: "open_project_file", arguments: { path: "it" }, userText: "Open it." }).success, false);
});
