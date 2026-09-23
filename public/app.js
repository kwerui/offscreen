import {
  addBubble,
  bindControls,
  clearToolStatus,
  finalizeUserTranscript,
  getVoiceAgentSettings,
  resetUserPartialTranscript,
  setConnectButtonDisabled,
  setDisconnectButtonDisabled,
  setHostedDemoPrompt,
  setListeningControlState,
  setStatus,
  setVoiceWakeButtonState,
  setVoiceWakeUnavailable,
  setHostedDemoNoticeVisible,
  showToolStatus,
  updateUserPartialTranscript,
} from "./ui.js";
import {
  flushPlayback,
  hasAudioResources,
  pauseMicrophoneCapture,
  playListeningStateCue,
  playPCM,
  prepareMicrophoneCapture,
  setUpAudio,
  startMicrophoneCapture,
  tearDownAudio,
} from "./audio.js";
import { getRuntimeCapabilities } from "./capabilities.js";
import { getVoiceTools } from "./tools.js";
import { openWebsite } from "./website-tool.js";
import { getCalendarEvents } from "./calendar-tool.js";
import { getGitStatus } from "./git-status-tool.js";
import { getGitDiff } from "./git-diff-tool.js";
import { getCommitDiff, getGitHistory } from "./git-history-tool.js";
import {
  openProjectFile,
  readProjectFile,
  searchProject,
} from "./project-workspace-tool.js";
import { runProjectTests } from "./project-tests-tool.js";
import { createProjectReferenceContext } from "./project-reference-context.js";
import { createCommitReferenceContext } from "./commit-reference-context.js";
import { runCodexTask } from "./codex-tool.js";
import { runBrowserTool } from "./browser-tool.js";
import {
  createCodexCallTracker,
  createInteractiveCallTracker,
} from "./codex-call-tracker.js";
import { createToolResultCoordinator } from "./tool-result-coordinator.js";
import { createSessionActivityLedger } from "./session-activity-ledger.js";
import { createVoiceSession } from "./voice-session.js";
import { createPhraseListener, createWakeListener } from "./wake-listener.js";

const capabilities = getRuntimeCapabilities(
  globalThis.__OFFSCREEN_CAPABILITIES__
);
const voiceTools = getVoiceTools(capabilities);

let activeSessionId = 0;

let standbyMode = false;

let voiceWakeEnabled = false;

let normalSystemPrompt = "";

let suppressStandbyReply = false;

let standbyResumePending = false;

let standbyListenerPending = false;

let activeToolTurnId = 0;

const interruptedToolTurnIds = new Set();

let pendingDisconnect;

let lastCompletedAgentResponse = null;

let pendingAgentResponse = null;

let isAgentReplyOpen = false;

const activeActivities = new Map();
const sessionActivityLedger = createSessionActivityLedger();
const activityToolCalls = new Map();

let completedUserTurnId = 0;

let latestCompletedUserTurn = null;

const projectFileOpenAttempts = new Set();
const gitDiffInFlightPaths = new Set();
const gitDiffTerminalResults = new Map();

const projectReferenceContext = capabilities.developerWorkspace
  ? createProjectReferenceContext()
  : null;
const commitReferenceContext = capabilities.developerWorkspace
  ? createCommitReferenceContext()
  : null;

let pendingProjectReferenceResultCallId = null;
let pendingCommitReferenceResultCallId = null;
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
  "ALWAYS call pause_listening. When the user explicitly says 'enable wake phrase', " +
  "ALWAYS call enable_wake_phrase; after success, say exactly 'Wake phrase enabled.' " +
  "When the user explicitly says 'disable wake phrase', ALWAYS call " +
  "disable_wake_phrase; after success, say exactly 'Wake phrase disabled.' When the " +
  "user asks what Offscreen is currently " +
  "doing, working on, or running, answer only from the Current Offscreen activity " +
  "context in the system prompt. Do not call a tool, advertise capabilities, or " +
  "reinterpret that question as a new task. If nothing is running, say so briefly. " +
  "For what Offscreen just did, actions completed so far, failed actions, whether a recent action " +
  "succeeded, or whether a recent test run passed, ALWAYS call get_session_activity. Do not guess " +
  "from conversation memory. Keep activity answers concise and use the returned receipt summaries.";

const HOSTED_DEMO_PROMPT =
  "You are Offscreen, an eyes-free voice companion. Have a natural conversation " +
  "and use open_website only when the user asks to open one supported website. " +
  "Do not advertise or imply capabilities that are not available in this hosted demo.";

const STANDBY_INSTRUCTIONS =
  "You are in standby. Do not answer questions, start tools, or perform normal " +
  "tasks. Wait for the client to handle explicit requests to resume listening or " +
  "disconnect.";

const STANDBY_RESUME_COMMANDS = new Set([
  "resume listening",
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
  projectFileOpenAttempts.clear();
  gitDiffInFlightPaths.clear();
  gitDiffTerminalResults.clear();
}

function getProjectFileOpenAttemptKey(path, line) {
  return JSON.stringify({
    userTurnId: latestCompletedUserTurn?.id ?? 0,
    path: path ?? null,
    line: line ?? null,
  });
}

function getGitDiffAttemptKey(path) {
  return JSON.stringify({
    userTurnId: latestCompletedUserTurn?.id ?? 0,
    path: path ?? null,
  });
}

function registerProjectReferenceResult(toolName, result, sessionId, toolTurnId) {
  if (isActiveToolTurn(sessionId, toolTurnId)) {
    projectReferenceContext?.registerResult(toolName, result);
  }
}

function createGitHistoryResultForAgent(result) {
  if (!result?.success) return result;
  const commits = result.commits.map(({ id, reference, parentCount, ...commit }) => commit);
  return {
    ...result,
    commits,
    // Keep the default voice list useful for immediate ordinal follow-ups.
    // The commit context still makes only titles actually spoken eligible.
    presentation: { commits: commits.slice(0, 3) },
  };
}

function createSearchProjectResultForAgent(result) {
  if (!result?.success || !Array.isArray(result.presentation?.files)) {
    return result;
  }

  const presentedPaths = result.presentation.files
    .map((file) => file?.path)
    .filter((path) => typeof path === "string");
  const matches = presentedPaths.flatMap((path) =>
    (result.matches ?? []).filter((match) => match?.path === path)
  );

  return {
    success: true,
    query: result.query,
    matches,
    files: presentedPaths.map((path) => ({ path })),
    presentation: result.presentation,
    truncated: Boolean(result.truncated || result.presentation.truncated),
  };
}

function resolveProjectToolArguments(event) {
  return projectReferenceContext?.resolve({
    toolName: event.name,
    arguments: event.arguments,
    userText: latestCompletedUserTurn?.text,
  }) ?? { success: true, arguments: event.arguments ?? {} };
}

const ACTIVITY_TOOL_CATEGORIES = new Map([
  ["get_git_status", "git_status"],
  ["search_project", "project_search"],
  ["read_project_file", "project_file"],
  ["open_project_file", "project_file"],
  ["run_project_tests", "project_tests"],
  ["get_git_diff", "git_diff"],
  ["get_git_history", "git_history"],
  ["get_commit_diff", "commit_diff"],
  ["ask_codex", "codex"],
]);

function beginActionReceipt(event, sessionId, toolTurnId) {
  const category = ACTIVITY_TOOL_CATEGORIES.get(event.name);
  if (!category || !isActiveToolTurn(sessionId, toolTurnId)) return;

  if (sessionActivityLedger.begin({
    callId: event.call_id,
    tool: event.name,
    category,
  })) {
    activityToolCalls.set(event.call_id, event.name);
  }
}

function getActionReceiptSummary(tool, result) {
  if (result?.cancelled) {
    return tool === "run_project_tests"
      ? "The project test run was cancelled."
      : "The action was cancelled.";
  }

  if (result?.timedOut || result?.errorCode === "test_timeout") {
    return tool === "run_project_tests" ? "Project tests timed out." : "The action timed out.";
  }

  if (!result?.success) return result?.error || "The action failed.";

  if (tool === "get_git_status") {
    const changedFiles = ["staged", "unstaged", "untracked"]
      .reduce((count, key) => count + (result[key]?.length ?? 0), 0);
    return changedFiles === 0 ? "Checked Git status: working tree clean." : `Checked Git status: ${changedFiles} changed files.`;
  }
  if (tool === "search_project") return `Searched the project and found ${result.files?.length ?? 0} files.`;
  if (tool === "read_project_file") return `Read ${result.path ?? "a project file"}.`;
  if (tool === "open_project_file") return `Opened ${result.path ?? "a project file"}${result.line ? ` at line ${result.line}` : ""}.`;
  if (tool === "run_project_tests") {
    return result.passed ? `Ran project tests: ${result.passedCount ?? 0} passed.` : "Ran project tests: failures found.";
  }
  if (tool === "get_git_diff") return `Inspected current Git changes across ${result.files?.length ?? 0} files.`;
  if (tool === "get_git_history") return `Listed ${result.commits?.length ?? 0} recent commits.`;
  if (tool === "get_commit_diff") return "Inspected changes from a recent commit.";
  return "Codex completed its project inspection.";
}

function completeActionReceipt(callId, result) {
  const tool = activityToolCalls.get(callId);
  if (!tool) return;

  sessionActivityLedger.setTarget(callId, {
    path: result?.path,
    line: result?.line ?? result?.startLine,
  });
  const didComplete = sessionActivityLedger.complete(callId, {
    ...result,
    summary: getActionReceiptSummary(tool, result),
  });

  if (didComplete) {
    activityToolCalls.delete(callId);
  }
}

function getSessionActivityResult(argumentsObject) {
  const filter = argumentsObject?.filter === "failed" ? "failed" : "all";
  const limit = Number.isInteger(argumentsObject?.limit)
    ? Math.min(Math.max(argumentsObject.limit, 1), 10)
    : 5;
  const receipts = sessionActivityLedger.list({ filter, limit }).map((receipt) => ({
    sequence: receipt.sequence,
    tool: receipt.tool,
    status: receipt.status,
    summary: receipt.summary,
    target: receipt.target,
  }));

  return {
    success: true,
    receipts,
    message: receipts.length === 0 ? "No matching actions have completed in this session." : undefined,
  };
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

function updateSystemPrompt({ includeTools = true } = {}) {
  const session = {
    system_prompt: getSystemPrompt(),
  };

  if (includeTools) {
    session.tools = standbyMode ? [] : voiceTools;
  }

  return voiceSession.send({
    type: "session.update",
    session,
  });
}

function syncCurrentActivityPrompt() {
  if (!normalSystemPrompt || !voiceSession.isOpen()) {
    return;
  }

  // Activity text changes the prompt only. Re-sending tools while one of them
  // is held can reconfigure the agent's active tool state mid-execution.
  updateSystemPrompt({ includeTools: false });
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

function getStandbyLocalCommand(normalizedText) {
  if (STANDBY_RESUME_COMMANDS.has(normalizedText)) {
    return "resume";
  }

  if (STANDBY_DISCONNECT_COMMANDS.has(normalizedText)) {
    return "disconnect";
  }

  return null;
}

function startStandbyListener() {
  if (!standbyMode || !voiceSession.isOpen()) {
    return false;
  }

  if (!standbyListener.isSupported()) {
    setStatus(
      "connected",
      "Standby — use Resume Listening or Disconnect controls."
    );
    return false;
  }

  if (!standbyListener.start()) {
    setStatus(
      "connected",
      "Standby — voice resume unavailable; use Resume Listening."
    );
    return false;
  }

  setStatus(
    "connected",
    'Standby — say “Resume listening” or “Disconnect”; other speech is not sent to the Voice Agent.'
  );
  return true;
}

function handleStandbyPhrase(normalizedPhrase) {
  if (!standbyMode || !voiceSession.isOpen()) {
    return;
  }

  const command = getStandbyLocalCommand(normalizedPhrase);

  if (command === "resume") {
    void leaveStandby();
  } else if (command === "disconnect") {
    endActiveSession();
  }
}

function handleStandbyListenerError(error) {
  console.warn("Standby listener error:", error);

  if (!standbyMode || !voiceSession.isOpen()) {
    return;
  }

  setStatus(
    "connected",
    "Standby — voice resume unavailable; use Resume Listening."
  );
}

function activateStandbyListener() {
  if (!standbyMode || standbyResumePending || !voiceSession.isOpen()) {
    standbyListenerPending = false;
    return false;
  }

  standbyListenerPending = false;
  flushPlayback();
  const listenerStarted = startStandbyListener();
  playListeningStateCue("paused");
  return listenerStarted;
}

function enterStandby(sessionId, { deferLocalListener = false } = {}) {
  if (!isActiveSession(sessionId) || !voiceSession.isOpen()) {
    return;
  }

  if (!standbyMode) {
    clearPendingBrowserConfirmation(true);
    standbyMode = true;
    standbyResumePending = false;
    standbyListenerPending = deferLocalListener;
    suppressStandbyReply = false;
    updateSystemPrompt();
    pauseMicrophoneCapture();
  } else if (deferLocalListener) {
    standbyListenerPending = true;
  }

  setListeningControlState(true, false);

  if (standbyListenerPending) {
    setStatus("connected", "Pausing listening…");
    return;
  }

  activateStandbyListener();
}

async function leaveStandby() {
  if (
    !standbyMode ||
    standbyResumePending ||
    !voiceSession.isOpen()
  ) {
    return;
  }

  const sessionId = activeSessionId;
  standbyResumePending = true;
  standbyListenerPending = false;
  standbyListener.stop();
  setListeningControlState(true, true);
  setStatus("connected", "Resuming listening…");

  try {
    const microphoneWasPrepared = await prepareMicrophoneCapture({
      isSessionActive: () =>
        isActiveSession(sessionId) &&
        voiceSession.isOpen() &&
        standbyMode,
    });

    if (!microphoneWasPrepared) {
      if (
        isActiveSession(sessionId) &&
        voiceSession.isOpen() &&
        standbyMode
      ) {
        throw new Error("Microphone capture unavailable");
      }

      return;
    }

    if (
      !isActiveSession(sessionId) ||
      !voiceSession.isOpen() ||
      !standbyMode
    ) {
      return;
    }

    standbyMode = false;

    // No AssemblyAI audio is sent during standby, so the resume phrase cannot
    // create a stale model reply. Keep this guard for any already-open reply
    // that predates entering standby.
    if (!isAgentReplyOpen) {
      suppressStandbyReply = false;
    }

    updateSystemPrompt();
    setListeningControlState(false, false);
    setStatus("connected", "Connected");
    startMicrophoneCapture();
    playListeningStateCue("listening");
  } catch (err) {
    if (!isActiveSession(sessionId) || !voiceSession.isOpen()) {
      return;
    }

    console.error("Microphone resume error:", err.cause || err);
    setListeningControlState(true, false);
    startStandbyListener();
  } finally {
    standbyResumePending = false;
  }
}

function toggleListening() {
  if (standbyMode) {
    void leaveStandby();
    return;
  }

  enterStandby(activeSessionId);
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

  void connect("Wake phrase heard — connecting…");
}

function handleVoiceWakeError(error) {
  console.warn("Voice wake error:", error);

  voiceWakeEnabled = false;
  updateVoiceWakeButton();

  let statusText = "Wake Phrase is unavailable";

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

const standbyListener = createPhraseListener({
  phrases: [
    ...STANDBY_RESUME_COMMANDS,
    ...STANDBY_DISCONNECT_COMMANDS,
  ],
  onPhrase: handleStandbyPhrase,
  onError: handleStandbyListenerError,
});

function updateVoiceWakeButton(disabled = false) {
  if (!wakeListener.isSupported()) {
    setVoiceWakeUnavailable();
    return;
  }

  setVoiceWakeButtonState(voiceWakeEnabled, disabled);
}

function setVoiceWakePreference(enabled) {
  if (!wakeListener.isSupported()) {
    return false;
  }

  voiceWakeEnabled = enabled;
  updateVoiceWakeButton();

  if (!enabled) {
    wakeListener.stop();

    if (!voiceSession.hasConnection() && !hasAudioResources()) {
      setStatus("", "Disconnected");
    }

    return true;
  }

  if (voiceSession.hasConnection() || hasAudioResources()) {
    return true;
  }

  if (wakeListener.start()) {
    setStatus("", VOICE_WAKE_STATUS);
    return true;
  }

  return false;
}

updateVoiceWakeButton();
setHostedDemoNoticeVisible(capabilities.isHostedDemo);
setHostedDemoPrompt(capabilities.isHostedDemo ? HOSTED_DEMO_PROMPT : null);

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

const projectTestCallTracker = createInteractiveCallTracker({
  sendCancellationResult: (sessionId, toolTurnId, callId, result) => (
    sendToolResult(sessionId, toolTurnId, callId, result, true)
  ),
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
      if (callId === pendingProjectReferenceResultCallId) {
        projectReferenceContext?.markPendingSearchResultReady();
        pendingProjectReferenceResultCallId = null;
      }
      if (callId === pendingCommitReferenceResultCallId) {
        commitReferenceContext?.markPendingHistoryReady();
        pendingCommitReferenceResultCallId = null;
      }

      codexCallTracker.resolveCall(callId);
      projectTestCallTracker.resolveCall(callId);
    }

    return wasSent;
  },
  onFlush: (resultCount) => {
    console.log(`Sending ${resultCount} tool result(s)`);
  },
  onQueueResult: completeActionReceipt,
});

function invalidateToolTurn(updateActivityPrompt = true) {
  activeToolTurnId++;
  pendingDisconnect = null;
  pendingProjectReferenceResultCallId = null;
  pendingCommitReferenceResultCallId = null;
  projectReferenceContext?.discardPendingSearchResult();
  commitReferenceContext?.discardPendingHistory();
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
  projectTestCallTracker.cancelSupersededCalls(sessionId, toolTurnId);
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

async function connect(connectionStatus = "Requesting token…") {
  const sessionId = activeSessionId + 1;

  wakeListener.stop();
  sessionActivityLedger.clear();
  activityToolCalls.clear();
  resetStoredAgentResponses();
  standbyMode = false;
  standbyResumePending = false;
  standbyListenerPending = false;
  setListeningControlState(false, true);
  updateVoiceWakeButton(true);

  if (voiceSession.hasConnection() || hasAudioResources()) {
    activeSessionId = sessionId;
    teardown("", "Disconnected", false);
  } else {
    activeSessionId = sessionId;
  }

  setConnectButtonDisabled(true);

  setStatus("connecting", connectionStatus);

  try {
    await voiceSession.connect({
      prepareConnection: async () => {
        try {
          const audioWasSetUp = await setUpAudio({
            isSessionActive: () => isActiveSession(sessionId),
            onMicrophoneAudio: (audio) => {
              if (!isActiveSession(sessionId) || standbyMode) {
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
        const basePrompt = capabilities.isHostedDemo
          ? HOSTED_DEMO_PROMPT
          : voiceAgentSettings.prompt;
        const dateInstructions = capabilities.calendar
          ? `\n\nToday's date is ${today}. Use this to interpret relative calendar dates such as Friday, Wednesday, or the 28th.`
          : "";
        normalSystemPrompt =
          basePrompt +
          `\n\n${FIXED_OFFSCREEN_INSTRUCTIONS}` +
          dateInstructions;

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

            tools: voiceTools,
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
      setListeningControlState(false, false);
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
        // AssemblyAI should receive no new microphone audio while paused.
        // Any transcript that still arrives here is stale/in-flight and must
        // never control standby. Resume/disconnect are owned by the local
        // standby listener.
        finalizeUserTranscript(event.text, "ignored in standby");
        suppressStandbyReply = true;
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
          projectTestCallTracker.cancelSupersededCalls(
            sessionId,
            interruptedToolTurnId
          );
        }

        interruptedToolTurnIds.clear();

        codexCallTracker.cancelSupersededCalls(sessionId, activeToolTurnId);
        projectTestCallTracker.cancelSupersededCalls(
          sessionId,
          activeToolTurnId
        );
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

      if (standbyMode || suppressStandbyReply) {
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
        if (standbyMode && standbyListenerPending) {
          // A voice-triggered pause begins while AssemblyAI is still closing
          // the reply that contained the pause tool call. Starting the local
          // recognizer before this boundary can let it hear the tail of the
          // user's own "Pause listening" utterance. Hand microphone ownership
          // to the local standby listener only after that reply is complete.
          activateStandbyListener();
        }

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
          projectReferenceContext?.alignPendingSearchResult(pendingAgentResponse);
          commitReferenceContext?.alignPendingHistory(pendingAgentResponse);
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
  beginActionReceipt(event, sessionId, toolTurnId);

  // ---------------------------------
  // SESSION ACTIVITY
  // ---------------------------------

  if (event.name === "get_session_activity") {
    toolResultCoordinator.queueResult(
      sessionId,
      toolTurnId,
      event.call_id,
      getSessionActivityResult(event.arguments)
    );

    return;
  }

  // ---------------------------------
  // PAUSE LISTENING
  // ---------------------------------

  if (event.name === "pause_listening") {
    enterStandby(sessionId, { deferLocalListener: true });

    // Pause is a client-owned state transition. Do not let the model speak a
    // post-tool acknowledgement such as “OK, I’m on standby” after the local
    // standby recognizer has started: the browser recognizer can hear speaker
    // output and accidentally interpret it as a resume command. The local
    // descending earcon is the eyes-free pause acknowledgement instead.
    suppressStandbyReply = true;

    toolResultCoordinator.queueResult(
      sessionId,
      toolTurnId,
      event.call_id,
      { success: true, standby: true }
    );

    return;
  }

  // ---------------------------------
  // WAKE PHRASE PREFERENCE
  // ---------------------------------

  if (
    event.name === "enable_wake_phrase" ||
    event.name === "disable_wake_phrase"
  ) {
    const enabled = event.name === "enable_wake_phrase";
    const updated = setVoiceWakePreference(enabled);

    toolResultCoordinator.queueResult(
      sessionId,
      toolTurnId,
      event.call_id,
      updated
        ? {
            success: true,
            enabled,
            message: enabled
              ? "Wake phrase enabled."
              : "Wake phrase disabled.",
          }
        : {
            success: false,
            error: "Wake Phrase is unavailable in this browser.",
          }
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
  // DEVELOPER WORKSPACE
  // ---------------------------------

  const projectToolNames = new Set([
    "search_project",
    "read_project_file",
    "open_project_file",
    "get_git_diff",
  ]);
  const resolvedProjectCall = projectToolNames.has(event.name)
    ? resolveProjectToolArguments(event)
    : null;

  if (resolvedProjectCall && !resolvedProjectCall.success) {
    toolResultCoordinator.queueResult(
      sessionId,
      toolTurnId,
      event.call_id,
      { success: false, error: resolvedProjectCall.error, terminal: true }
    );
    return;
  }

  if (event.name === "search_project") {
    startActivity(
      sessionId,
      toolTurnId,
      event.call_id,
      "Searching the project."
    );

    try {
      const result = await searchProject(resolvedProjectCall.arguments.query);
      registerProjectReferenceResult(event.name, result, sessionId, toolTurnId);

      if (result?.success && isActiveToolTurn(sessionId, toolTurnId)) {
        pendingProjectReferenceResultCallId = event.call_id;
      }

      toolResultCoordinator.queueResult(
        sessionId,
        toolTurnId,
        event.call_id,
        createSearchProjectResultForAgent(result)
      );
    } finally {
      finishActivity(sessionId, toolTurnId, event.call_id);
    }

    return;
  }

  if (event.name === "read_project_file") {
    startActivity(
      sessionId,
      toolTurnId,
      event.call_id,
      "Reading a project file."
    );

    try {
      const result = await readProjectFile(
        resolvedProjectCall.arguments.path,
        resolvedProjectCall.arguments.start_line,
        resolvedProjectCall.arguments.end_line
      );
      registerProjectReferenceResult(event.name, result, sessionId, toolTurnId);

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

  if (event.name === "open_project_file") {
    const attemptKey = getProjectFileOpenAttemptKey(
      resolvedProjectCall.arguments.path,
      resolvedProjectCall.arguments.line
    );

    if (projectFileOpenAttempts.has(attemptKey)) {
      toolResultCoordinator.queueResult(
        sessionId,
        toolTurnId,
        event.call_id,
        {
          success: false,
          error: "This project file opening request was already handled.",
          terminal: true,
        }
      );
      return;
    }

    projectFileOpenAttempts.add(attemptKey);

    startActivity(
      sessionId,
      toolTurnId,
      event.call_id,
      "Opening a project file in VS Code."
    );

    try {
      const result = await openProjectFile(
        resolvedProjectCall.arguments.path,
        resolvedProjectCall.arguments.line
      );
      registerProjectReferenceResult(event.name, result, sessionId, toolTurnId);

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

  if (event.name === "get_git_status") {
    startActivity(
      sessionId,
      toolTurnId,
      event.call_id,
      "Checking the project Git status."
    );

    try {
      const result = await getGitStatus();
      registerProjectReferenceResult(event.name, result, sessionId, toolTurnId);

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

  if (event.name === "get_git_history") {
    startActivity(sessionId, toolTurnId, event.call_id, "Checking recent project Git history.");
    try {
      const result = await getGitHistory();
      if (result?.success && isActiveToolTurn(sessionId, toolTurnId)) {
        commitReferenceContext?.registerHistory(result);
        pendingCommitReferenceResultCallId = event.call_id;
      }
      toolResultCoordinator.queueResult(sessionId, toolTurnId, event.call_id, createGitHistoryResultForAgent(result));
    } finally {
      finishActivity(sessionId, toolTurnId, event.call_id);
    }
    return;
  }

  if (event.name === "get_commit_diff") {
    const resolvedCommit = commitReferenceContext?.resolve(event.arguments, latestCompletedUserTurn?.text)
      ?? { success: false, error: "I need a recent commit list before I can inspect a commit." };
    if (!resolvedCommit.success) {
      toolResultCoordinator.queueResult(sessionId, toolTurnId, event.call_id, { success: false, error: resolvedCommit.error, terminal: true });
      return;
    }
    startActivity(sessionId, toolTurnId, event.call_id, "Inspecting a recent project commit.");
    try {
      const result = await getCommitDiff(resolvedCommit.reference);
      registerProjectReferenceResult(event.name, result, sessionId, toolTurnId);
      if (result?.success && isActiveToolTurn(sessionId, toolTurnId)) pendingProjectReferenceResultCallId = event.call_id;
      toolResultCoordinator.queueResult(sessionId, toolTurnId, event.call_id, result);
    } finally {
      finishActivity(sessionId, toolTurnId, event.call_id);
    }
    return;
  }

  if (event.name === "get_git_diff") {
    const attemptKey = getGitDiffAttemptKey(resolvedProjectCall.arguments.path);
    const terminalResult = gitDiffTerminalResults.get(attemptKey);

    if (terminalResult) {
      toolResultCoordinator.queueResult(
        sessionId,
        toolTurnId,
        event.call_id,
        terminalResult
      );
      return;
    }

    if (gitDiffInFlightPaths.has(attemptKey)) {
      toolResultCoordinator.queueResult(
        sessionId,
        toolTurnId,
        event.call_id,
        {
          success: false,
          error: "This project Git diff request is already being handled.",
          terminal: true,
        }
      );
      return;
    }

    gitDiffInFlightPaths.add(attemptKey);
    startActivity(
      sessionId,
      toolTurnId,
      event.call_id,
      "Inspecting the project Git diff."
    );

    try {
      const result = await getGitDiff(resolvedProjectCall.arguments.path);

      if (result?.terminal) {
        gitDiffTerminalResults.set(attemptKey, result);
      }
      registerProjectReferenceResult(event.name, result, sessionId, toolTurnId);

      if (result?.success && isActiveToolTurn(sessionId, toolTurnId)) {
        pendingProjectReferenceResultCallId = event.call_id;
      }

      toolResultCoordinator.queueResult(
        sessionId,
        toolTurnId,
        event.call_id,
        result
      );
    } finally {
      gitDiffInFlightPaths.delete(attemptKey);
      finishActivity(sessionId, toolTurnId, event.call_id);
    }

    return;
  }

  if (event.name === "run_project_tests") {
    projectTestCallTracker.registerCall(sessionId, toolTurnId, event.call_id);

    startActivity(
      sessionId,
      toolTurnId,
      event.call_id,
      "Running the project tests."
    );

    try {
      const result = await runProjectTests();
      registerProjectReferenceResult(event.name, result, sessionId, toolTurnId);

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

  completeActionReceipt(callId, result);

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
  projectTestCallTracker.clear();
  projectReferenceContext?.clear();
  commitReferenceContext?.clear();
  sessionActivityLedger.clear();
  activityToolCalls.clear();
  pendingProjectReferenceResultCallId = null;
  resetStoredAgentResponses();
  standbyMode = false;
  standbyResumePending = false;
  standbyListenerPending = false;
  normalSystemPrompt = "";

  standbyListener.stop();
  voiceSession.disconnect();
  tearDownAudio();
  resetUserPartialTranscript();
  setStatus(statusState, statusText);
  setConnectButtonDisabled(false);
  setDisconnectButtonDisabled(true);
  setListeningControlState(false, true);
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
  setVoiceWakePreference(!voiceWakeEnabled);
}

bindControls(connect, disconnect, toggleListening, toggleVoiceWake);
