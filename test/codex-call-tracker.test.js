import assert from "node:assert/strict";
import test from "node:test";
import {
  createCodexCallTracker,
  createInteractiveCallTracker,
} from "../public/codex-call-tracker.js";

function createTracker() {
  const cancellationResults = [];
  const tracker = createCodexCallTracker({
    sendCancellationResult: (sessionId, toolTurnId, callId, result) => {
      cancellationResults.push({ sessionId, toolTurnId, callId, result });
      return true;
    },
  });

  return { cancellationResults, tracker };
}

test("registers an unresolved Codex call", () => {
  const { cancellationResults, tracker } = createTracker();

  tracker.registerCall(1, 2, "codex-call");
  tracker.cancelSupersededCalls(1, 2);

  assert.equal(cancellationResults.length, 1);
});

test("provides the same lifecycle tracker for another interactive tool", () => {
  const cancellationResults = [];
  const tracker = createInteractiveCallTracker({
    sendCancellationResult: (_sessionId, _toolTurnId, callId) => {
      cancellationResults.push(callId);
      return true;
    },
  });

  tracker.registerCall(1, 2, "project-test-call");
  tracker.cancelSupersededCalls(1, 2);

  assert.deepEqual(cancellationResults, ["project-test-call"]);
});

test("removes a Codex call after its normal result is sent", () => {
  const { cancellationResults, tracker } = createTracker();

  tracker.registerCall(1, 2, "codex-call");
  tracker.resolveCall("codex-call");
  tracker.cancelSupersededCalls(1, 2);

  assert.deepEqual(cancellationResults, []);
});

test("supersedes a call with its original call ID", () => {
  const { cancellationResults, tracker } = createTracker();

  tracker.registerCall(1, 2, "original-codex-call");
  tracker.cancelSupersededCalls(1, 2);

  assert.deepEqual(cancellationResults, [{
    sessionId: 1,
    toolTurnId: 2,
    callId: "original-codex-call",
    result: {
      success: false,
      cancelled: true,
      error: "Superseded by a newer user request.",
    },
  }]);
});

test("only supersedes Codex calls from the matching session and turn", () => {
  const { cancellationResults, tracker } = createTracker();

  tracker.registerCall(1, 2, "matching-call");
  tracker.registerCall(1, 3, "newer-turn-call");
  tracker.registerCall(2, 2, "other-session-call");
  tracker.cancelSupersededCalls(1, 2);

  assert.deepEqual(cancellationResults.map((result) => result.callId), [
    "matching-call",
  ]);
});

test("does not resolve a cancelled call twice", () => {
  const { cancellationResults, tracker } = createTracker();

  tracker.registerCall(1, 2, "codex-call");
  tracker.cancelSupersededCalls(1, 2);
  tracker.cancelSupersededCalls(1, 2);

  assert.equal(cancellationResults.length, 1);
});

test("clears tracked calls during reset", () => {
  const { cancellationResults, tracker } = createTracker();

  tracker.registerCall(1, 2, "codex-call");
  tracker.clear();
  tracker.cancelSupersededCalls(1, 2);

  assert.deepEqual(cancellationResults, []);
});

test("keeps a Codex call tracked when cancellation cannot be sent", () => {
  let shouldSend = false;
  const cancellationResults = [];

  const tracker = createCodexCallTracker({
    sendCancellationResult: (sessionId, toolTurnId, callId, result) => {
      if (!shouldSend) {
        return false;
      }

      cancellationResults.push({
        sessionId,
        toolTurnId,
        callId,
        result,
      });

      return true;
    },
  });

  tracker.registerCall(1, 2, "codex-call");

  tracker.cancelSupersededCalls(1, 2);
  assert.equal(cancellationResults.length, 0);

  shouldSend = true;
  tracker.cancelSupersededCalls(1, 2);
  assert.equal(cancellationResults.length, 1);

  tracker.cancelSupersededCalls(1, 2);
  assert.equal(cancellationResults.length, 1);
});
