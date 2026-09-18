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
