import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  APPLICATION_MODES,
  getClientCapabilities,
  getCapabilities,
  getRuntimeCapabilities,
} from "../public/capabilities.js";
import { getVoiceTools, VOICE_TOOLS } from "../public/tools.js";

const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

const LOCAL_ONLY_TOOL_NAMES = [
  "get_calendar_events",
  "search_project",
  "read_project_file",
  "open_project_file",
  "get_git_diff",
  "get_git_status",
  "run_project_tests",
  "ask_codex",
  "browser_navigate",
  "browser_read_page",
  "browser_find_on_page",
  "browser_go_back",
  "browser_click",
  "browser_type",
  "browser_confirm_action",
];

test("LOCAL capabilities preserve every current voice tool", () => {
  const capabilities = getCapabilities(APPLICATION_MODES.LOCAL);

  assert.deepEqual(getVoiceTools(capabilities), VOICE_TOOLS);
  assert.equal(capabilities.calendar, true);
  assert.equal(capabilities.codex, true);
  assert.equal(capabilities.developerWorkspace, true);
  assert.equal(capabilities.browserControl, true);
});

test("HOSTED_DEMO capabilities omit every local-only voice tool", () => {
  const capabilities = getCapabilities(APPLICATION_MODES.HOSTED_DEMO);
  const toolNames = getVoiceTools(capabilities).map((tool) => tool.name);

  for (const toolName of LOCAL_ONLY_TOOL_NAMES) {
    assert.equal(toolNames.includes(toolName), false, `${toolName} must be absent`);
  }

  assert.deepEqual(toolNames.sort(), [
    "cancel_current_work",
    "disconnect_session",
    "open_website",
    "pause_listening",
    "repeat_last_response",
    "summarize_last_response",
  ].sort());
});

test("only exact configured modes are accepted", () => {
  assert.equal(getCapabilities().isHostedDemo, false);
  assert.equal(getCapabilities("").isHostedDemo, false);
  assert.equal(getCapabilities("LOCAL").isHostedDemo, false);
  assert.equal(getCapabilities("HOSTED_DEMO").isHostedDemo, true);

  for (const invalidMode of [
    "hosted_demo",
    "HOSTED-DEMO",
    "HOSTED_DEMO ",
    "random",
  ]) {
    assert.throws(
      () => getCapabilities(invalidMode),
      /Invalid OFFSCREEN_MODE/
    );
  }

  assert.deepEqual(
    getClientCapabilities(APPLICATION_MODES.HOSTED_DEMO),
    {
      isHostedDemo: true,
      calendar: false,
      codex: false,
      developerWorkspace: false,
      browserControl: false,
    }
  );
});

test("missing client runtime capabilities fall back to the hosted-safe tool set", () => {
  const capabilities = getRuntimeCapabilities();
  const toolNames = getVoiceTools(capabilities).map((tool) => tool.name);

  assert.equal(capabilities.isHostedDemo, true);
  for (const toolName of LOCAL_ONLY_TOOL_NAMES) {
    assert.equal(toolNames.includes(toolName), false, `${toolName} must be absent`);
  }
});

test("LOCAL keeps the hosted-demo disclosure hidden", () => {
  assert.equal(getCapabilities(APPLICATION_MODES.LOCAL).isHostedDemo, false);
  assert.match(appSource, /setHostedDemoNoticeVisible\(capabilities\.isHostedDemo\)/);
  assert.match(indexSource, /id="hosted-demo-notice" hidden/);
});
