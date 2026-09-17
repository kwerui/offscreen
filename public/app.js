import {
  addBubble,
  bindControls,
  clearToolStatus,
  finalizeUserTranscript,
  getVoiceAgentSettings,
  resetUserPartialTranscript,
  setConnectButtonDisabled,
  setDisconnectButtonDisabled,
  setStatus,
  showToolStatus,
  updateUserPartialTranscript,
} from "./ui.js";
import {
  flushPlayback,
  hasAudioResources,
  playPCM,
  setUpAudio,
  startMicrophoneCapture,
  tearDownAudio,
} from "./audio.js";
import { VOICE_TOOLS } from "./tools.js";
import { openWebsite } from "./website-tool.js";
import { getCalendarEvents } from "./calendar-tool.js";
import { runCodexTask } from "./codex-tool.js";
import { createCodexCallTracker } from "./codex-call-tracker.js";
import { createToolResultCoordinator } from "./tool-result-coordinator.js";
import { createVoiceSession } from "./voice-session.js";

let activeSessionId = 0;

let activeToolTurnId = 0;

const interruptedToolTurnIds = new Set();

let pendingDisconnect;

function isActiveSession(sessionId) {
  return sessionId === activeSessionId;
}

function isActiveToolTurn(sessionId, toolTurnId) {
  return (
    isActiveSession(sessionId) && toolTurnId === activeToolTurnId
  );
}

const voiceSession = createVoiceSession();

const codexCallTracker = createCodexCallTracker({
  sendCancellationResult: (sessionId, toolTurnId, callId, result) => {
    const wasSent = sendToolResult(
      sessionId,
      toolTurnId,
      callId,
      result,
      true
    );

    if (wasSent) {
      console.log("Superseded Codex tool cancelled");
    }

    return wasSent;
  },
});

const toolResultCoordinator = createToolResultCoordinator({
  isCurrent: isActiveToolTurn,
  canSendResults: (sessionId, toolTurnId) => (
    isActiveToolTurn(sessionId, toolTurnId) && voiceSession.isOpen()
  ),
  sendToolResult: (sessionId, toolTurnId, callId, result) => {
    const wasSent = sendToolResult(
      sessionId,
      toolTurnId,
      callId,
      result
    );

    if (wasSent) {
      codexCallTracker.resolveCall(callId);
    }

    return wasSent;
  },
  onFlush: (resultCount) => {
    console.log(`Sending ${resultCount} tool result(s)`);
  },
});

function invalidateToolTurn() {
  activeToolTurnId++;
  pendingDisconnect = null;
  toolResultCoordinator.reset();
  clearToolStatus();
}

function cancelCurrentToolWork(sessionId, toolTurnId, callId) {
  if (!isActiveToolTurn(sessionId, toolTurnId)) {
    return;
  }

  // Send tracked Codex cancellations while their original turn is still valid.
  codexCallTracker.cancelSupersededCalls(sessionId, toolTurnId);

  // Advancing the turn drops queued and future results from all old tool work.
  invalidateToolTurn();

  // The cancellation tool itself acknowledges on the newly active turn.
  toolResultCoordinator.queueResult(
    sessionId,
    activeToolTurnId,
    callId,
    { success: true, cancelled: true }
  );
}

function endActiveSession(statusState = "", statusText = "Disconnected") {
  activeSessionId++;
  teardown(statusState, statusText);
}

async function connect() {
  const sessionId = activeSessionId + 1;

  if (voiceSession.hasConnection() || hasAudioResources()) {
    activeSessionId = sessionId;
    teardown();
  } else {
    activeSessionId = sessionId;
  }

  setConnectButtonDisabled(true);

  setStatus("connecting", "Requesting token…");

  try {
    await voiceSession.connect({
      prepareConnection: async () => {
        try {
          const audioWasSetUp = await setUpAudio({
            isSessionActive: () => isActiveSession(sessionId),
            onMicrophoneAudio: (audio) => {
              if (!isActiveSession(sessionId)) {
                return;
              }

              voiceSession.send({
                type: "input.audio",
                audio,
              });
            },
          });

          if (!audioWasSetUp) {
            return false;
          }
        } catch (err) {
          if (!isActiveSession(sessionId)) {
            return false;
          }

          if (err.stage === "microphone") {
            console.error("Mic permission denied:", err.cause);
            endActiveSession("error", "Mic blocked");
          } else {
            console.error("Audio setup error:", err.cause);
            endActiveSession("error", "Audio setup error");
          }

          return false;
        }

        setStatus("connecting", "Connecting…");

        return true;
      },
      onOpen: () => {
        if (!isActiveSession(sessionId)) {
          return;
        }

        const now = new Date();

        const today = [
          now.getFullYear(),
          String(now.getMonth() + 1).padStart(2, "0"),
          String(now.getDate()).padStart(2, "0"),
        ].join("-");

        const voiceAgentSettings = getVoiceAgentSettings();

        voiceSession.send({
          type: "session.update",
          session: {
            system_prompt:
              voiceAgentSettings.prompt +
              `\n\nToday's date is ${today}. Use this to interpret relative calendar dates such as Friday, Wednesday, or the 28th.`,

            greeting: voiceAgentSettings.greeting,

            input: {
              turn_detection: {
                vad_threshold: 0.5,
                min_silence: 1000,
                max_silence: 3000,
                interrupt_response: true,
              },
            },

            output: {
              voice: voiceAgentSettings.voice,
            },

            tools: VOICE_TOOLS,
          },
        });
      },
      onEvent: (event) => handleEvent(event, sessionId),
      onError: (err) => {
        if (!isActiveSession(sessionId)) {
          return;
        }

        console.error("WebSocket error:", err);
        endActiveSession("error", "Connection error");
      },
      onClose: (event) => {
        if (!isActiveSession(sessionId)) {
          return;
        }

        console.log("WebSocket closed:", event.code);

        endActiveSession();
      },
    });
  } catch (err) {
    if (!isActiveSession(sessionId)) {
      return;
    }

    if (err.stage === "token") {
      console.error("Token request failed");
      endActiveSession("error", "Token error");
    } else {
      console.error("WebSocket setup error:", err);
      endActiveSession("error", "Connection error");
    }
  }
}

function handleEvent(event, sessionId) {
  if (!isActiveSession(sessionId)) {
    return;
  }

  if (event.type !== "reply.audio") {
    console.log("AssemblyAI event:", event.type);
  }

  switch (event.type) {
    case "session.ready":
      console.log("Voice session ready");

      setStatus("connected", `Connected (${event.session_id})`);

      setDisconnectButtonDisabled(false);

      startMicrophoneCapture();

      break;

    case "session.updated":
      console.log("Voice session updated");

      break;

    case "input.speech.started":
      toolResultCoordinator.setReplyDone(false);
      break;

    case "transcript.user.delta":
      updateUserPartialTranscript(event.text);

      break;

    case "transcript.user":
      if (event.text?.trim()) {
        // An interrupted reply alone does not prove a newer request exists.
        for (const interruptedToolTurnId of interruptedToolTurnIds) {
          codexCallTracker.cancelSupersededCalls(
            sessionId,
            interruptedToolTurnId
          );
        }

        interruptedToolTurnIds.clear();

        codexCallTracker.cancelSupersededCalls(sessionId, activeToolTurnId);
        invalidateToolTurn();
      }

      finalizeUserTranscript(event.text);

      break;

    case "reply.started":
      toolResultCoordinator.setReplyDone(false);
      break;

    case "reply.audio":
      playPCM(event.data, () => isActiveSession(sessionId));
      break;

    case "transcript.agent": {
      const meta = event.interrupted ? "interrupted" : null;

      addBubble("agent", event.text, meta);

      break;
    }

    case "tool.call":
      const toolTurnId = activeToolTurnId;

      toolResultCoordinator.startTask();

      handleToolCall(event, sessionId, toolTurnId)
        .catch(() => {
          console.error("Tool handler failed");
        })
        .finally(() => {
          if (!isActiveToolTurn(sessionId, toolTurnId)) {
            return;
          }

          toolResultCoordinator.finishTask();

          toolResultCoordinator.flush(sessionId, toolTurnId);
        });

      break;

    case "reply.done":
      if (event.status === "interrupted") {
        flushPlayback();

        interruptedToolTurnIds.add(activeToolTurnId);
        invalidateToolTurn();
      } else {
        toolResultCoordinator.setReplyDone(true);

        toolResultCoordinator.flush(sessionId, activeToolTurnId);
      }

      break;

    case "session.error":
      console.error("Session error:", event.code);
      setStatus("error", `${event.code}: ${event.message}`);

      break;
  }
}

async function handleToolCall(event, sessionId, toolTurnId) {
  console.log("Tool called:", event.name);

  // ---------------------------------
  // DISCONNECT SESSION
  // ---------------------------------

  if (event.name === "disconnect_session") {
    pendingDisconnect = {
      sessionId,
      toolTurnId,
      callId: event.call_id,
    };

    toolResultCoordinator.queueResult(
      sessionId,
      toolTurnId,
      event.call_id,
      { success: true, disconnected: true }
    );

    return;
  }

  // ---------------------------------
  // CANCEL CURRENT TOOL WORK
  // ---------------------------------

  if (event.name === "cancel_current_work") {
    cancelCurrentToolWork(sessionId, toolTurnId, event.call_id);

    return;
  }

  // ---------------------------------
  // OPEN WEBSITE
  // ---------------------------------

  if (event.name === "open_website") {
    const result = openWebsite(event.arguments?.site);

    toolResultCoordinator.queueResult(
      sessionId,
      toolTurnId,
      event.call_id,
      result
    );

    return;
  }

  // ---------------------------------
  // GOOGLE CALENDAR
  // ---------------------------------

  if (event.name === "get_calendar_events") {
    const result = await getCalendarEvents(event.arguments?.when);

    toolResultCoordinator.queueResult(
      sessionId,
      toolTurnId,
      event.call_id,
      result
    );

    return;
  }

  // ---------------------------------
  // CODEX
  // ---------------------------------

  if (event.name === "ask_codex") {
    codexCallTracker.registerCall(sessionId, toolTurnId, event.call_id);

    const task = event.arguments?.task;

    if (task) {
      showToolStatus(
        "Codex is checking your project…",
        sessionId,
        toolTurnId,
        isActiveToolTurn
      );
    }

    const result = await runCodexTask(task);
    clearToolStatus(sessionId, toolTurnId);

    toolResultCoordinator.queueResult(
      sessionId,
      toolTurnId,
      event.call_id,
      result
    );

    return;
  }

  // ---------------------------------
  // UNKNOWN TOOL
  // ---------------------------------

  toolResultCoordinator.queueResult(sessionId, toolTurnId, event.call_id, {
    success: false,
    error: `Unknown tool: ${event.name}`,
  });
}

function sendToolResult(
  sessionId,
  toolTurnId,
  callId,
  result,
  allowSupersededToolTurn = false
) {
  if (
    (!allowSupersededToolTurn && !isActiveToolTurn(sessionId, toolTurnId)) ||
    (allowSupersededToolTurn && !isActiveSession(sessionId)) ||
    !voiceSession.isOpen()
  ) {
    return false;
  }

  const wasSent = voiceSession.send({
    type: "tool.result",
    call_id: callId,
    result: JSON.stringify(result),
  });

  if (!wasSent) {
    return false;
  }

  if (
    pendingDisconnect?.sessionId === sessionId &&
    pendingDisconnect.toolTurnId === toolTurnId &&
    pendingDisconnect.callId === callId
  ) {
    const disconnectRequest = pendingDisconnect;

    queueMicrotask(() => {
      if (
        pendingDisconnect !== disconnectRequest ||
        !isActiveToolTurn(sessionId, toolTurnId)
      ) {
        return;
      }

      endActiveSession();
    });
  }

  return true;
}

function teardown(statusState = "", statusText = "Disconnected") {
  invalidateToolTurn();
  interruptedToolTurnIds.clear();
  codexCallTracker.clear();

  voiceSession.disconnect();
  tearDownAudio();
  resetUserPartialTranscript();
  setStatus(statusState, statusText);
  setConnectButtonDisabled(false);
  setDisconnectButtonDisabled(true);
}

function disconnect() {
  endActiveSession();
}

bindControls(connect, disconnect);
