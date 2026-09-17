import assert from "node:assert/strict";
import test from "node:test";
import { VOICE_TOOLS } from "../public/tools.js";

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
