export function createToolResultCoordinator({
  isCurrent,
  canSendResults,
  sendToolResult,
  onFlush,
  onQueueResult,
}) {
  let pendingResults = [];
  let activeTasks = 0;
  let replyDone = false;

  function reset() {
    pendingResults = [];
    activeTasks = 0;
    replyDone = false;
  }

  function startTask() {
    activeTasks++;
  }

  function finishTask() {
    activeTasks--;
  }

  function setReplyDone(isDone) {
    replyDone = isDone;
  }

  function queueResult(sessionId, toolTurnId, callId, result) {
    if (!isCurrent(sessionId, toolTurnId)) {
      return;
    }

    onQueueResult?.(callId, result);

    pendingResults.push({
      callId,
      result,
    });
  }

  function flush(sessionId, toolTurnId) {
    if (!isCurrent(sessionId, toolTurnId)) {
      return;
    }

    if (!replyDone || activeTasks > 0 || pendingResults.length === 0) {
      return;
    }

    onFlush?.(pendingResults.length);

    if (!canSendResults(sessionId, toolTurnId)) {
      replyDone = false;
      return;
    }

    for (const toolResult of pendingResults) {
      sendToolResult(
        sessionId,
        toolTurnId,
        toolResult.callId,
        toolResult.result
      );
    }

    pendingResults = [];
    replyDone = false;
  }

  return {
    finishTask,
    flush,
    queueResult,
    reset,
    setReplyDone,
    startTask,
  };
}
