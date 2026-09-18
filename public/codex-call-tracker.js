export function createInteractiveCallTracker({ sendCancellationResult }) {
  const unresolvedCalls = new Map();

  function registerCall(sessionId, toolTurnId, callId) {
    unresolvedCalls.set(callId, {
      sessionId,
      toolTurnId,
      callId,
    });
  }

  function resolveCall(callId) {
    unresolvedCalls.delete(callId);
  }

  function cancelSupersededCalls(sessionId, toolTurnId) {
    for (const [callId, codexCall] of unresolvedCalls) {
      if (
        codexCall.sessionId !== sessionId ||
        codexCall.toolTurnId !== toolTurnId
      ) {
        continue;
      }

      const wasSent = sendCancellationResult(
        sessionId,
        toolTurnId,
        codexCall.callId,
        {
          success: false,
          cancelled: true,
          error: "Superseded by a newer user request.",
        }
      );

      if (wasSent) {
        unresolvedCalls.delete(callId);
      }
    }
  }

  function clear() {
    unresolvedCalls.clear();
  }

  return {
    cancelSupersededCalls,
    clear,
    registerCall,
    resolveCall,
  };
}

// Kept for the existing Codex integration while other interactive tools use
// the behaviorally named factory above.
export const createCodexCallTracker = createInteractiveCallTracker;
