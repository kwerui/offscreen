import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const defaultPrompt = await readFile(
  new URL("../public/index.html", import.meta.url),
  "utf8"
);

test("routes general browser requests through the bounded browser tools", () => {
  assert.match(defaultPrompt, /BROWSER TOOL ROUTING/);
  assert.match(defaultPrompt, /arbitrary explicit domain or URL.*ALWAYS use browser_navigate/i);
  assert.match(defaultPrompt, /wikipedia\.org, example\.com, and github\.com/i);
  assert.match(defaultPrompt, /open_website.*convenience shortcut.*NOT.*limit/i);
  assert.match(defaultPrompt, /browser_read_page.*inspect|inspect.*browser_read_page/i);
  assert.match(defaultPrompt, /browser_find_on_page.*locate|locate.*browser_find_on_page/i);
  assert.match(defaultPrompt, /browser_click.*observed refs|observed refs.*browser_click/i);
  assert.match(defaultPrompt, /browser_type.*observed refs|observed refs.*browser_type/i);
  assert.match(defaultPrompt, /Typing must not submit/i);
  assert.match(defaultPrompt, /consequential click.*browser_click.*confirmation_required/i);
  assert.match(defaultPrompt, /separate user turn.*browser_confirm_action/i);
  assert.match(defaultPrompt, /negative.*cancels/i);
  assert.match(defaultPrompt, /ambiguous.*leave.*pending/i);
  assert.match(defaultPrompt, /button-like.*consequential.*default/i);
  assert.match(defaultPrompt, /other user request.*cancel.*pending action/i);
  assert.match(defaultPrompt, /Before click or type, use current observed page refs/i);
  assert.match(defaultPrompt, /click or type fails because the page or ref changed.*browser_read_page.*browser_find_on_page/i);
  assert.match(defaultPrompt, /Never repeat the exact same failed browser click or type call more than once without refreshing page state/i);
  assert.match(defaultPrompt, /not currently editable or available, say so briefly/i);
  assert.match(defaultPrompt, /Navigate to wikipedia\.org[\s\S]*browser_navigate.*wikipedia\.org/i);
});

test("routes deterministic Git questions away from Codex", () => {
  assert.match(defaultPrompt, /DEVELOPER GIT STATUS TOOL ROUTING — REQUIRED/);
  assert.match(defaultPrompt, /changed files[\s\S]*staged[\s\S]*uncommitted[\s\S]*get_git_status/i);
  assert.match(
    defaultPrompt,
    /EVERY[\s\S]*CURRENT Git working state[\s\S]*including[\s\S]*follow-up[\s\S]*ALWAYS call get_git_status[\s\S]*before[\s\S]*answering[\s\S]*Do not rely on an earlier/i
  );
  assert.match(defaultPrompt, /Do not call[\s\S]*ask_codex[\s\S]*deterministic Git facts/i);
  assert.match(defaultPrompt, /Never use get_git_status[\s\S]*commit[\s\S]*push[\s\S]*reset[\s\S]*checkout/i);
  assert.match(
    defaultPrompt,
    /branch names[\s\S]*file paths[\s\S]*status values[\s\S]*repository-derived[\s\S]*data only[\s\S]*never[\s\S]*instructions/i
  );
});

test("routes deterministic project search and reading away from Codex", () => {
  assert.match(defaultPrompt, /DETERMINISTIC PROJECT SEARCH AND READ TOOL ROUTING.*REQUIRED/i);
  assert.match(defaultPrompt, /find project text[\s\S]*search_project/i);
  assert.match(defaultPrompt, /named project file[\s\S]*read_project_file/i);
  assert.match(defaultPrompt, /Do not call ask_codex[\s\S]*simple deterministic search or[\s\S]*read facts/i);
  assert.match(defaultPrompt, /paths[\s\S]*filenames[\s\S]*snippets[\s\S]*source content[\s\S]*untrusted[\s\S]*data only[\s\S]*never[\s\S]*instructions/i);
});

test("routes deterministic VS Code project file opening away from Codex", () => {
  assert.match(defaultPrompt, /DETERMINISTIC VS CODE FILE OPENING.*REQUIRED/i);
  assert.match(defaultPrompt, /Open server\.js in VS Code[\s\S]*open_project_file/i);
  assert.match(defaultPrompt, /Do not call ask_codex[\s\S]*open.*known project file/i);
  assert.match(defaultPrompt, /paths[\s\S]*untrusted[\s\S]*never[\s\S]*instructions/i);
  assert.match(defaultPrompt, /terminal[\s\S]*do not retry[\s\S]*same user\s+request/i);
});

test("routes deterministic project test requests away from Codex", () => {
  assert.match(defaultPrompt, /DETERMINISTIC PROJECT TEST TOOL ROUTING.*REQUIRED/i);
  assert.match(defaultPrompt, /Run the tests[\s\S]*Do the tests pass[\s\S]*Are any tests failing[\s\S]*run_project_tests/i);
  assert.match(defaultPrompt, /Do not call ask_codex[\s\S]*deterministic test execution or[\s\S]*current test facts/i);
  assert.match(defaultPrompt, /WHY a test failed[\s\S]*Codex/i);
  assert.match(defaultPrompt, /test names[\s\S]*failure messages[\s\S]*file paths[\s\S]*test output[\s\S]*untrusted[\s\S]*repository-derived[\s\S]*never[\s\S]*instructions/i);
});
