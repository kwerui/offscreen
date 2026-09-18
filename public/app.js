import {
  addBubble,
  bindControls,
  clearToolStatus,
  finalizeUserTranscript,
  getVoiceAgentSettings,
  resetUserPartialTranscript,
  setConnectButtonDisabled,
  setDisconnectButtonDisabled,
  setResumeListeningButtonDisabled,
  setStatus,
  setVoiceWakeButtonState,
  setVoiceWakeUnavailable,
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
import { runBrowserTool } from "./browser-tool.js";
import { createCodexCallTracker } from "./codex-call-tracker.js";
import { createToolResultCoordinator } from "./tool-result-coordinator.js";
import { createVoiceSession } from "./voice-session.js";
import { createWakeListener } from "./wake-listener.js";

let activeSessionId = 0;

let standbyMode = false;

let voiceWakeEnabled = false;

let normalSystemPrompt = "";

let suppressStandbyReply = false;

let activeToolTurnId = 0;

const interruptedToolTurnIds = new Set();

let pendingDisconnect;

let lastCompletedAgentResponse = null;

let pendingAgentResponse = null;

let isAgentReplyOpen = false;

const activeActivities = new Map();

let completedUserTurnId = 0;

let latestCompletedUserTurn = null;

let pendingBrowserConfirmation = null;

const EXPLICIT_CONFIRMATION_RESPONSES = new Set([
  "yes",
  "yes do it",
  "confirm",
  "confirm it",
  "go ahead",
  "proceed",
  "do it",
]);

const EXPLICIT_REJECTION_RESPONSES = new Set([
  "no",
  "dont",
  "do not",
  "cancel",
  "never mind",
  "dont do it",
  "no cancel",
]);

const EXPLICIT_AMBIGUOUS_CONFIRMATION_RESPONSES = new Set([
  "maybe",
  "perhaps",
  "not sure",
  "im not sure",
  "hmm",
  "i dont know",
]);

const FIXED_OFFSCREEN_INSTRUCTIONS =
  "When the user explicitly asks Offscreen to repeat its most recent response, " +
  "ALWAYS call repeat_last_response rather than repeating from conversation " +
  "memory. When repeat_last_response succeeds, speak the returned response " +
  "exactly, with no prefix, suffix, summary, paraphrase, or additional tool " +
  "calls. When it fails, briefly state that no completed response is available. " +
  "When the user explicitly asks Offscreen to shorten, summarize, condense, give " +
  "a TL;DR, or give a shorter version of its most recent response, ALWAYS call " +
  "summarize_last_response rather than summarizing from conversation memory. " +
  "When summarize_last_response succeeds, summarize or shorten only the returned " +
  "response, preserve its key meaning, follow the user's requested degree and " +
  "style of shortening, do not introduce unrelated information or call or rerun " +
  "any other tool, and answer directly without a preface when possible. When it " +
  "fails, briefly state that no completed response is available. When the user " +
  "explicitly asks Offscreen to pause listening, stop listening, or go on standby, " +
  "ALWAYS call pause_listening. When the user asks what Offscreen is currently " +
  "doing, working on, or running, answer only from the Current Offscreen activity " +
  "context in the system prompt. Do not call a tool, advertise capabilities, or " +
  "reinterpret that question as a new task. If nothing is running, say so briefly.";

const STANDBY_INSTRUCTIONS =
  "You are in standby. Do not answer questions, start tools, or perform normal " +
  "tasks. Wait for the client to handle explicit requests to resume listening or " +
  "disconnect.";

const STANDBY_RESUME_COMMANDS = new Set([
  "resume listening",
  "start listening again",
  "continue listening",
  "leave standby",
]);

const STANDBY_DISCONNECT_COMMANDS = new Set([
  "disconnect",
  "disconnect session",
  "end the session",
  "hang up",
]);

const CURRENT_ACTIVITY_QUERIES = new Set([
  "what are you doing",
  "what're you doing",
  "what you're doing",
  "what are you doing now",
  "what are you doing right now",
  "what are you currently doing",
  "what are you working on",
  "what're you working on",
  "what is happening",
  "what's happening",
  "what is running",
  "what's running",
  "what are you up to",
]);

const VOICE_WAKE_PHRASE = "connect offscreen";

const VOICE_WAKE_STATUS =
  'Disconnected — browser speech recognition is listening for “Connect Offscreen”';

function isActiveSession(sessionId) {
  return sessionId === activeSessionId;
}

function isActiveToolTurn(sessionId, toolTurnId) {
  return (
    isActiveSession(sessionId) && toolTurnId === activeToolTurnId
  );
}

function normalizeConfirmationResponse(text) {
  return text
    ?.trim()
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/'/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isExplicitConfirmation(text) {
  const normalizedText = normalizeConfirmationResponse(text);

  return (
    EXPLICIT_CONFIRMATION_RESPONSES.has(normalizedText) ||
    /^yes (?:submit|send|delete|remove|buy|purchase|checkout|pay|donate|publish|authorize|confirm)(?: it)?$/.test(normalizedText)
  );
}

function isExplicitRejection(text) {
  return EXPLICIT_REJECTION_RESPONSES.has(normalizeConfirmationResponse(text));
}

function isExplicitAmbiguousConfirmation(text) {
  return EXPLICIT_AMBIGUOUS_CONFIRMATION_RESPONSES.has(
    normalizeConfirmationResponse(text)
  );
}

function clearPendingBrowserConfirmation(cancelOnServer = false) {
  const hadPendingConfirmation = Boolean(pendingBrowserConfirmation);
  pendingBrowserConfirmation = null;

  if (hadPendingConfirmation) {
    syncCurrentActivityPrompt();
  }

  if (cancelOnServer && hadPendingConfirmation) {
    void runBrowserTool("cancel_confirmation");
  }
}

function getBrowserConfirmationContext() {
  if (!pendingBrowserConfirmation) {
    return "";
  }

  if (pendingBrowserConfirmation.latestResponseWasAmbiguous) {
    return (
      "\n\nA consequential browser action is still pending. The latest user response was ambiguous. " +
      "Ask for a clear yes or no. Do not execute or claim it was cancelled."
    );
  }

  return (
    "\n\nA consequential browser action is pending. It has not executed. " +
    "Only a separate explicit affirmative user turn may authorize the stored action."
  );
}

function recordCompletedUserTurn(text) {
  if (!text?.trim()) {
    return;
  }

  completedUserTurnId++;
  latestCompletedUserTurn = { id: completedUserTurnId, text };
}

function getCurrentActivityText() {
  const descriptions = [
    ...new Set(
      [...activeActivities.values()].map((activity) => activity.description)
    ),
  ];

  if (descriptions.length === 0) {
    return "Nothing is running right now.";
  }

  return descriptions.join(" ");
}

function getSystemPrompt() {
  const activityContext = normalSystemPrompt
    ? `\n\nCurrent Offscreen activity: ${getCurrentActivityText()}`
    : "";
  const standbyInstructions = standbyMode
    ? `\n\n${STANDBY_INSTRUCTIONS}`
    : "";
  const browserConfirmationContext = normalSystemPrompt
    ? getBrowserConfirmationContext()
    : "";

  return `${normalSystemPrompt}${activityContext}${browserConfirmationContext}${standbyInstructions}`;
}

function updateSystemPrompt() {
  return voiceSession.send({
    type: "session.update",
    session: {
      system_prompt: getSystemPrompt(),
      tools: standbyMode ? [] : VOICE_TOOLS,
    },
  });
}

function syncCurrentActivityPrompt() {
  if (!normalSystemPrompt || !voiceSession.isOpen()) {
    return;
  }

  updateSystemPrompt();
}

function startActivity(sessionId, toolTurnId, callId, description) {
  if (!isActiveToolTurn(sessionId, toolTurnId)) {
    return;
  }

  activeActivities.set(callId, {
    sessionId,
    toolTurnId,
    description,
  });
  syncCurrentActivityPrompt();
}

function finishActivity(sessionId, toolTurnId, callId) {
  const activity = activeActivities.get(callId);

  if (
    !activity ||
    activity.sessionId !== sessionId ||
    activity.toolTurnId !== toolTurnId
  ) {
    return;
  }

  activeActivities.delete(callId);
  syncCurrentActivityPrompt();
}

function clearActivities(updatePrompt = true) {
  if (activeActivities.size === 0) {
    return;
  }

  activeActivities.clear();

  if (updatePrompt) {
    syncCurrentActivityPrompt();
  }
}

function isCurrentActivityQuery(text) {
  const normalizedText = text
    ?.trim()
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[.?!]+$/, "")
    .replace(/\s+/g, " ");

  return CURRENT_ACTIVITY_QUERIES.has(normalizedText);
}

function getStandbyCommand(text) {
  const normalizedText = text
    ?.trim()
    .toLowerCase()
    .replace(/[.?!]+$/, "")
    .replace(/\s+/g, " ");

  if (STANDBY_RESUME_COMMANDS.has(normalizedText)) {
    return "resume";
  }

  if (STANDBY_DISCONNECT_COMMANDS.has(normalizedText)) {
    return "disconnect";
  }

  return null;
}

function enterStandby(sessionId) {
  if (!isActiveSession(sessionId) || !voiceSession.isOpen()) {
    return;
  }

  if (!standbyMode) {
    clearPendingBrowserConfirmation(true);
    standbyMode = true;
    suppressStandbyReply = false;
    updateSystemPrompt();
  }

  setResumeListeningButtonDisabled(false);
  setStatus(
    "connected",
    'Standby — audio is still transcribed for “resume listening” or “disconnect”; other speech is ignored.'
  );
}

function leaveStandby() {
  if (!standbyMode || !voiceSession.isOpen()) {
    return;
  }

  standbyMode = false;

  // If the user resumes while an ignored standby reply is still finishing,
  // keep suppressing that old reply until its reply.done arrives.
  if (!isAgentReplyOpen) {
    suppressStandbyReply = false;
  }

  updateSystemPrompt();
  setResumeListeningButtonDisabled(true);
  setStatus("connected", "Connected");
}

const voiceSession = createVoiceSession();

function handleVoiceWake() {
  if (
    !voiceWakeEnabled ||
    voiceSession.hasConnection() ||
    hasAudioResources()
  ) {
    return;
  }

  void connect();
}

function handleVoiceWakeError(error) {
  console.warn("Voice wake error:", error);

  voiceWakeEnabled = false;
  updateVoiceWakeButton();

  let statusText = `Voice wake error (${error})`;

  if (error === "audio-capture") {
    statusText = "Voice wake microphone unavailable";
  } else if (error === "not-allowed" || error === "service-not-allowed") {
    statusText = "Voice wake permission denied";
  }

  setStatus("error", statusText);
}

const wakeListener = createWakeListener({
  phrase: VOICE_WAKE_PHRASE,
  onWake: handleVoiceWake,
  onError: handleVoiceWakeError,
});

function updateVoiceWakeButton(disabled = false) {
  if (!wakeListener.isSupported()) {
    setVoiceWakeUnavailable();
    return;
  }

  setVoiceWakeButtonState(voiceWakeEnabled, disabled);
}

updateVoiceWakeButton();

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

function invalidateToolTurn(updateActivityPrompt = true) {
  activeToolTurnId++;
  pendingDisconnect = null;
  toolResultCoordinator.reset();
  clearToolStatus();
  clearActivities(updateActivityPrompt);
}

function resetStoredAgentResponses() {
  lastCompletedAgentResponse = null;
  pendingAgentResponse = null;
  isAgentReplyOpen = false;
  suppressStandbyReply = false;
}

function cancelCurrentToolWork(sessionId, toolTurnId, callId) {
  if (!isActiveToolTurn(sessionId, toolTurnId)) {
    return;
  }

  // Send tracked Codex cancellations while their original turn is still valid.
  codexCallTracker.cancelSupersededCalls(sessionId, toolTurnId);
  clearPendingBrowserConfirmation(true);

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

  wakeListener.stop();
  resetStoredAgentResponses();
  standbyMode = false;
  setResumeListeningButtonDisabled(true);
  updateVoiceWakeButton(true);

  if (voiceSession.hasConnection() || hasAudioResources()) {
    activeSessionId = sessionId;
    teardown("", "Disconnected", false);
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
        normalSystemPrompt =
          voiceAgentSettings.prompt +
          `\n\n${FIXED_OFFSCREEN_INSTRUCTIONS}` +
          `\n\nToday's date is ${today}. Use this to interpret relative calendar dates such as Friday, Wednesday, or the 28th.`;

        voiceSession.send({
          type: "session.update",
          session: {
            system_prompt: getSystemPrompt(),

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
      setResumeListeningButtonDisabled(true);
      updateVoiceWakeButton();

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
      recordCompletedUserTurn(event.text);

      if (
        pendingBrowserConfirmation?.sessionId === sessionId &&
        isExplicitRejection(event.text)
      ) {
        clearPendingBrowserConfirmation(true);
      } else if (
        pendingBrowserConfirmation?.sessionId === sessionId &&
        isExplicitAmbiguousConfirmation(event.text)
      ) {
        pendingBrowserConfirmation.latestResponseWasAmbiguous = true;
        syncCurrentActivityPrompt();
      } else if (pendingBrowserConfirmation?.sessionId === sessionId) {
        if (isExplicitConfirmation(event.text)) {
          pendingBrowserConfirmation.latestResponseWasAmbiguous = false;
          syncCurrentActivityPrompt();
        } else {
          // A different request supersedes the pending action. Clearing both
          // client and backend state prevents a later yes from confirming it.
          clearPendingBrowserConfirmation(true);
        }
      }

      if (standbyMode) {
        const standbyCommand = getStandbyCommand(event.text);
        const transcriptMeta = standbyCommand ? null : "ignored in standby";

        finalizeUserTranscript(event.text, transcriptMeta);

        if (standbyCommand === "resume") {
          leaveStandby();
        } else if (standbyCommand === "disconnect") {
          endActiveSession();
        } else {
          suppressStandbyReply = true;
        }

        return;
      }

      if (event.text?.trim() && isCurrentActivityQuery(event.text)) {
        finalizeUserTranscript(event.text);
        break;
      }

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
      isAgentReplyOpen = true;
      pendingAgentResponse = null;
      break;

    case "reply.audio":
      if (suppressStandbyReply) {
        break;
      }

      playPCM(event.data, () => isActiveSession(sessionId));
      break;

    case "transcript.agent": {
      if (suppressStandbyReply) {
        break;
      }

      const meta = event.interrupted ? "interrupted" : null;

      addBubble("agent", event.text, meta);

      if (isAgentReplyOpen && !event.interrupted && event.text?.trim()) {
        pendingAgentResponse = event.text;
      }

      break;
    }

    case "tool.call":
      const toolTurnId = activeToolTurnId;

      toolResultCoordinator.startTask();

      if (standbyMode) {
        // Standby is client-controlled. A stale or misclassified model tool
        // call must never escape standby and execute real work.
        suppressStandbyReply = true;
        toolResultCoordinator.queueResult(
          sessionId,
          toolTurnId,
          event.call_id,
          {
            success: false,
            error: "Tool calls are unavailable while Offscreen is in standby.",
          }
        );
        toolResultCoordinator.finishTask();
        toolResultCoordinator.flush(sessionId, toolTurnId);
        break;
      }

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
      isAgentReplyOpen = false;

      if (suppressStandbyReply) {
        if (!standbyMode) {
          suppressStandbyReply = false;
        }

        pendingAgentResponse = null;
        toolResultCoordinator.setReplyDone(true);
        toolResultCoordinator.flush(sessionId, activeToolTurnId);
        break;
      }

      if (event.status === "interrupted") {
        pendingAgentResponse = null;
        flushPlayback();

        interruptedToolTurnIds.add(activeToolTurnId);
        invalidateToolTurn();
      } else {
        if (pendingAgentResponse?.trim()) {
          lastCompletedAgentResponse = pendingAgentResponse;
        }

        pendingAgentResponse = null;
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
  // PAUSE LISTENING
  // ---------------------------------

  if (event.name === "pause_listening") {
    enterStandby(sessionId);

    toolResultCoordinator.queueResult(
      sessionId,
      toolTurnId,
      event.call_id,
      { success: true, standby: true }
    );

    return;
  }

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
  // BROWSER CONFIRMATION
  // ---------------------------------

  if (event.name === "browser_confirm_action") {
    const userTurn = latestCompletedUserTurn;
    let result;

    if (
      !pendingBrowserConfirmation ||
      pendingBrowserConfirmation.sessionId !== sessionId
    ) {
      result = {
        success: false,
        error: "There is no pending browser action to confirm.",
        errorCode: "browser_confirmation_missing",
      };
    } else if (
      !userTurn ||
      userTurn.id <= pendingBrowserConfirmation.requestUserTurnId ||
      !isExplicitConfirmation(userTurn.text)
    ) {
      result = {
        success: false,
        error: "A new explicit confirmation is required before this browser action.",
        errorCode: "browser_confirmation_rejected",
      };
    } else {
      // Consume the client-side authorization before the request. The backend
      // separately consumes its stored action before it calls Playwright.
      clearPendingBrowserConfirmation();
      result = await runBrowserTool("confirm");
    }

    toolResultCoordinator.queueResult(
      sessionId,
      toolTurnId,
      event.call_id,
      result
    );

    return;
  }

  // ---------------------------------
  // REPEAT LAST RESPONSE
  // ---------------------------------

  if (event.name === "repeat_last_response") {
    const result = lastCompletedAgentResponse
      ? { success: true, response: lastCompletedAgentResponse }
      : {
          success: false,
          error: "No completed Offscreen response is available in this session.",
        };

    toolResultCoordinator.queueResult(
      sessionId,
      toolTurnId,
      event.call_id,
      result
    );

    return;
  }

  // ---------------------------------
  // SUMMARIZE LAST RESPONSE
  // ---------------------------------

  if (event.name === "summarize_last_response") {
    const result = lastCompletedAgentResponse
      ? { success: true, response: lastCompletedAgentResponse }
      : {
          success: false,
          error: "No completed Offscreen response is available in this session.",
        };

    toolResultCoordinator.queueResult(
      sessionId,
      toolTurnId,
      event.call_id,
      result
    );

    return;
  }

  // ---------------------------------
  // BROWSER
  // ---------------------------------

  const browserActions = {
    browser_navigate: {
      action: "navigate",
      input: { url: event.arguments?.url },
      activity: "Navigating the browser.",
    },
    browser_read_page: {
      action: "snapshot",
      input: {},
      activity: "Reading the current browser page.",
    },
    browser_find_on_page: {
      action: "find",
      input: { text: event.arguments?.text },
      activity: "Finding text on the current browser page.",
    },
    browser_go_back: {
      action: "back",
      input: {},
      activity: "Going back in the browser.",
    },
    browser_click: {
      action: "click",
      input: {
        target: event.arguments?.target,
        element: event.arguments?.element_description,
      },
      activity: "Clicking a browser element.",
    },
    browser_type: {
      action: "type",
      input: {
        target: event.arguments?.target,
        text: event.arguments?.text,
        element: event.arguments?.element_description,
      },
      activity: "Typing in the browser without submitting.",
    },
  };
  const browserAction = browserActions[event.name];

  if (browserAction) {
    if (["navigate", "back", "click", "type"].includes(browserAction.action)) {
      // The backend invalidates its exact stored action synchronously as part
      // of these page-changing operations. Mirror that lifecycle locally.
      clearPendingBrowserConfirmation();
    }

    startActivity(
      sessionId,
      toolTurnId,
      event.call_id,
      browserAction.activity
    );

    try {
      const result = await runBrowserTool(
        browserAction.action,
        browserAction.input
      );

      if (
        result.success &&
        ["snapshot", "find"].includes(browserAction.action)
      ) {
        // The backend refresh replaces its observed refs and invalidates the
        // stored confirmation. Keep the model-facing state in lockstep.
        clearPendingBrowserConfirmation();
      }

      if (result.confirmation_required) {
        if (isActiveToolTurn(sessionId, toolTurnId)) {
          pendingBrowserConfirmation = {
            sessionId,
            requestUserTurnId: latestCompletedUserTurn?.id ?? 0,
            latestResponseWasAmbiguous: false,
          };
          syncCurrentActivityPrompt();
        } else {
          // A stale turn must not leave a server-held action waiting.
          void runBrowserTool("cancel_confirmation");
        }
      }

      toolResultCoordinator.queueResult(
        sessionId,
        toolTurnId,
        event.call_id,
        result
      );
    } finally {
      finishActivity(sessionId, toolTurnId, event.call_id);
    }

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
    startActivity(
      sessionId,
      toolTurnId,
      event.call_id,
      "Checking your calendar."
    );

    try {
      const result = await getCalendarEvents(event.arguments?.when);

      toolResultCoordinator.queueResult(
        sessionId,
        toolTurnId,
        event.call_id,
        result
      );
    } finally {
      finishActivity(sessionId, toolTurnId, event.call_id);
    }

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

    startActivity(
      sessionId,
      toolTurnId,
      event.call_id,
      "Codex is checking your project."
    );

    try {
      const result = await runCodexTask(task);
      clearToolStatus(sessionId, toolTurnId);

      toolResultCoordinator.queueResult(
        sessionId,
        toolTurnId,
        event.call_id,
        result
      );
    } finally {
      finishActivity(sessionId, toolTurnId, event.call_id);
    }

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

function teardown(
  statusState = "",
  statusText = "Disconnected",
  restartVoiceWake = true
) {
  clearPendingBrowserConfirmation(true);
  invalidateToolTurn(false);
  interruptedToolTurnIds.clear();
  codexCallTracker.clear();
  resetStoredAgentResponses();
  standbyMode = false;
  normalSystemPrompt = "";

  voiceSession.disconnect();
  tearDownAudio();
  resetUserPartialTranscript();
  setStatus(statusState, statusText);
  setConnectButtonDisabled(false);
  setDisconnectButtonDisabled(true);
  setResumeListeningButtonDisabled(true);
  updateVoiceWakeButton();

  if (restartVoiceWake && voiceWakeEnabled && wakeListener.start()) {
    const wakeStatusText = statusState
      ? `${statusText} — voice wake is still listening for “Connect Offscreen”`
      : VOICE_WAKE_STATUS;

    setStatus(statusState, wakeStatusText);
  }
}

function disconnect() {
  endActiveSession();
}

function toggleVoiceWake() {
  if (!wakeListener.isSupported()) {
    return;
  }

  voiceWakeEnabled = !voiceWakeEnabled;
  updateVoiceWakeButton();

  if (!voiceWakeEnabled) {
    wakeListener.stop();

    if (!voiceSession.hasConnection() && !hasAudioResources()) {
      setStatus("", "Disconnected");
    }

    return;
  }

  if (voiceSession.hasConnection() || hasAudioResources()) {
    return;
  }

  if (wakeListener.start()) {
    setStatus("", VOICE_WAKE_STATUS);
  }
}

bindControls(connect, disconnect, leaveStandby, toggleVoiceWake);
