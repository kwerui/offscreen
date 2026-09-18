import assert from "node:assert/strict";
import test from "node:test";
import { VOICE_TOOLS } from "../public/tools.js";

test("defines the bounded browser voice tools", () => {
  const browserTools = [
    ["browser_navigate", ["url"]],
    ["browser_read_page", []],
    ["browser_find_on_page", ["text"]],
    ["browser_go_back", []],
    ["browser_click", ["target"]],
    ["browser_type", ["target", "text"]],
    ["browser_confirm_action", []],
  ];

  for (const [name, required] of browserTools) {
    const tool = VOICE_TOOLS.find((candidate) => candidate.name === name);
    assert.ok(tool, `${name} should be defined`);
    assert.deepEqual(tool.parameters.required, required);
    assert.equal(tool.execution_mode, "hold");
  }
});

test("describes safe ref-only browser interaction", () => {
  const clickTool = VOICE_TOOLS.find((tool) => tool.name === "browser_click");
  const typeTool = VOICE_TOOLS.find((tool) => tool.name === "browser_type");

  assert.match(clickTool.description, /ref.*browser_read_page|browser_read_page.*ref/i);
  assert.match(clickTool.description, /consequential.*confirmation|confirmation.*consequential/i);
  assert.match(clickTool.description, /never repeat.*failed click.*refreshed/i);
  assert.match(typeTool.description, /never submits/i);
  assert.match(typeTool.description, /not editable.*read or find/i);
});

test("defines a no-argument browser_confirm_action voice tool", () => {
  const confirmTool = VOICE_TOOLS.find(
    (tool) => tool.name === "browser_confirm_action"
  );

  assert.ok(confirmTool);
  assert.deepEqual(confirmTool.parameters, {
    type: "object",
    properties: {},
    required: [],
  });
  assert.match(confirmTool.description, /pending.*action/i);
  assert.match(confirmTool.description, /no.*ref|no.*target/i);
});

test("defines a no-argument disconnect_session voice tool", () => {
  const disconnectTool = VOICE_TOOLS.find(
    (tool) => tool.name === "disconnect_session"
  );

  assert.ok(disconnectTool);
  assert.deepEqual(disconnectTool.parameters, {
    type: "object",
    properties: {},
    required: [],
  });
});

test("defines a no-argument cancel_current_work voice tool", () => {
  const cancelTool = VOICE_TOOLS.find(
    (tool) => tool.name === "cancel_current_work"
  );

  assert.ok(cancelTool);
  assert.deepEqual(cancelTool.parameters, {
    type: "object",
    properties: {},
    required: [],
  });
});

test("defines a no-argument pause_listening voice tool", () => {
  const pauseTool = VOICE_TOOLS.find(
    (tool) => tool.name === "pause_listening"
  );

  assert.ok(pauseTool);
  assert.deepEqual(pauseTool.parameters, {
    type: "object",
    properties: {},
    required: [],
  });
  assert.match(pauseTool.description, /pause.*listening/i);
  assert.match(pauseTool.description, /session connected/i);
  assert.match(pauseTool.description, /standby/i);
});

test("defines a no-argument repeat_last_response voice tool", () => {
  const repeatTool = VOICE_TOOLS.find(
    (tool) => tool.name === "repeat_last_response"
  );

  assert.ok(repeatTool);
  assert.deepEqual(repeatTool.parameters, {
    type: "object",
    properties: {},
    required: [],
  });
  assert.match(repeatTool.description, /repeat.*completed/i);
});

test("defines a no-argument summarize_last_response voice tool", () => {
  const summarizeTool = VOICE_TOOLS.find(
    (tool) => tool.name === "summarize_last_response"
  );

  assert.ok(summarizeTool);
  assert.deepEqual(summarizeTool.parameters, {
    type: "object",
    properties: {},
    required: [],
  });
  assert.match(summarizeTool.description, /shorten|summarize/i);
  assert.match(summarizeTool.description, /not.*rerun.*previous tool/i);
});
