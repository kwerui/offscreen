import assert from "node:assert/strict";
import test from "node:test";
import { createToolResultCoordinator } from "../public/tool-result-coordinator.js";

function createCoordinator(options = {}) {
  const sentResults = [];
  let isCurrent = options.isCurrent ?? (() => true);
  let canSendResults = options.canSendResults ?? (() => true);

  const coordinator = createToolResultCoordinator({
    isCurrent: (...args) => isCurrent(...args),
    canSendResults: (...args) => canSendResults(...args),
    sendToolResult: (sessionId, toolTurnId, callId, result) => {
      sentResults.push({ sessionId, toolTurnId, callId, result });
      return true;
    },
  });

  return {
    coordinator,
    sentResults,
    setIsCurrent: (nextIsCurrent) => {
      isCurrent = nextIsCurrent;
    },
  };
}

test("does not flush a queued result while another tool task is active", () => {
  const { coordinator, sentResults } = createCoordinator();

  coordinator.startTask();
  coordinator.startTask();
  coordinator.queueResult(1, 1, "website-call", { success: true });
  coordinator.setReplyDone(true);
  coordinator.finishTask();
  coordinator.flush(1, 1);

  assert.deepEqual(sentResults, []);
});

test("flushes when active tool work finishes after reply completion", () => {
  const { coordinator, sentResults } = createCoordinator();

  coordinator.startTask();
  coordinator.queueResult(1, 1, "calendar-call", { success: true });
  coordinator.setReplyDone(true);
  coordinator.finishTask();
  coordinator.flush(1, 1);

  assert.deepEqual(sentResults, [{
    sessionId: 1,
    toolTurnId: 1,
    callId: "calendar-call",
    result: { success: true },
  }]);
});

test("flushes multiple queued results once and in order", () => {
  const { coordinator, sentResults } = createCoordinator();

  coordinator.queueResult(1, 1, "first-call", { index: 1 });
  coordinator.queueResult(1, 1, "second-call", { index: 2 });
  coordinator.setReplyDone(true);
  coordinator.flush(1, 1);
  coordinator.flush(1, 1);

  assert.deepEqual(sentResults.map((result) => result.callId), [
    "first-call",
    "second-call",
  ]);
});

test("reset clears queued results and reply state", () => {
  const { coordinator, sentResults } = createCoordinator();

  coordinator.queueResult(1, 1, "old-call", { success: true });
  coordinator.setReplyDone(true);
  coordinator.reset();
  coordinator.flush(1, 1);

  assert.deepEqual(sentResults, []);
});

test("does not queue or flush results for an invalid tool turn", () => {
  const { coordinator, sentResults, setIsCurrent } = createCoordinator({
    isCurrent: () => false,
  });

  coordinator.queueResult(1, 1, "stale-call", { success: true });
  coordinator.setReplyDone(true);
  coordinator.flush(1, 1);

  setIsCurrent(() => true);
  coordinator.flush(1, 1);

  assert.deepEqual(sentResults, []);
});

test("does not send when the supplied sender is unavailable", () => {
  const { coordinator, sentResults } = createCoordinator({
    canSendResults: () => false,
  });

  coordinator.queueResult(1, 1, "old-call", { success: true });
  coordinator.setReplyDone(true);
  coordinator.flush(1, 1);

  assert.deepEqual(sentResults, []);
});
