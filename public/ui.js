const els = {
  connect: document.getElementById("connect"),
  disconnect: document.getElementById("disconnect"),
  voiceWake: document.getElementById("voice-wake"),
  resumeListening: document.getElementById("resume-listening"),
  clear: document.getElementById("clear"),
  voice: document.getElementById("voice"),
  prompt: document.getElementById("prompt"),
  greeting: document.getElementById("greeting"),
  transcript: document.getElementById("transcript"),
  empty: document.getElementById("empty"),
  statusDot: document.getElementById("status-dot"),
  statusText: document.getElementById("status-text"),
  hostedDemoNotice: document.getElementById("hosted-demo-notice"),
};

let userPartialElement = null;
let toolStatusElement = null;
let toolStatusTimer = null;
let toolStatusStartedAt = null;
let toolStatusSessionId = null;
let toolStatusTurnId = null;

export function setStatus(state, text) {
  els.statusDot.className = "dot " + state;
  els.statusText.textContent = text;
}

export function setConnectButtonDisabled(disabled) {
  els.connect.disabled = disabled;
}

export function setDisconnectButtonDisabled(disabled) {
  els.disconnect.disabled = disabled;
}

export function setVoiceWakeButtonState(enabled, disabled = false) {
  els.voiceWake.textContent = enabled
    ? "Disable voice wake"
    : "Enable voice wake";
  els.voiceWake.disabled = disabled;
}

export function setVoiceWakeUnavailable() {
  els.voiceWake.textContent = "Voice wake unavailable";
  els.voiceWake.disabled = true;
}

export function setHostedDemoNoticeVisible(visible) {
  if (els.hostedDemoNotice) {
    els.hostedDemoNotice.hidden = !visible;
  }
}

export function setHostedDemoPrompt(prompt) {
  if (!prompt) {
    return;
  }

  els.prompt.value = prompt;
  els.prompt.disabled = true;
}

export function setResumeListeningButtonDisabled(disabled) {
  els.resumeListening.disabled = disabled;
}

export function getVoiceAgentSettings() {
  return {
    voice: els.voice.value,
    prompt: els.prompt.value,
    greeting: els.greeting.value,
  };
}

export function clearTranscript() {
  els.transcript.innerHTML = "";
  els.transcript.appendChild(els.empty);
  userPartialElement = null;
}

export function updateUserPartialTranscript(text) {
  if (!userPartialElement) {
    userPartialElement = ensureBubble("user", true);
  }

  userPartialElement.textContent = text;
  scrollTranscriptToBottom();
}

export function finalizeUserTranscript(text, meta) {
  if (userPartialElement) {
    userPartialElement.classList.remove("partial");
    userPartialElement.textContent = text;
    appendBubbleMeta(userPartialElement, meta);
    userPartialElement = null;
    return;
  }

  addBubble("user", text, meta);
}

export function resetUserPartialTranscript() {
  userPartialElement = null;
}

export function ensureBubble(role, partial = false) {
  if (els.empty.parentNode) {
    els.empty.remove();
  }

  const bubble = document.createElement("div");
  bubble.className =
    "bubble " + role + (partial ? " partial" : "");

  els.transcript.appendChild(bubble);
  scrollTranscriptToBottom();

  return bubble;
}

export function addBubble(role, text, meta) {
  const bubble = ensureBubble(role);
  bubble.textContent = text;
  appendBubbleMeta(bubble, meta);
  scrollTranscriptToBottom();
}

function appendBubbleMeta(bubble, meta) {
  if (!meta) {
    return;
  }

  const metaElement = document.createElement("span");
  metaElement.className = "meta";
  metaElement.textContent = meta;
  bubble.appendChild(metaElement);
}

export function showToolStatus(
  message,
  sessionId,
  toolTurnId,
  isActiveToolTurn
) {
  if (!isActiveToolTurn(sessionId, toolTurnId)) {
    return;
  }

  clearToolStatus();

  toolStatusStartedAt = Date.now();
  toolStatusSessionId = sessionId;
  toolStatusTurnId = toolTurnId;
  toolStatusElement = ensureBubble("agent", true);

  function updateStatus() {
    if (
      !isActiveToolTurn(sessionId, toolTurnId) ||
      toolStatusSessionId !== sessionId ||
      toolStatusTurnId !== toolTurnId
    ) {
      return;
    }

    const seconds = Math.floor(
      (Date.now() - toolStatusStartedAt) / 1000
    );

    toolStatusElement.textContent = `${message} ${seconds}s`;
  }

  updateStatus();
  toolStatusTimer = setInterval(updateStatus, 1000);
}

export function clearToolStatus(sessionId, toolTurnId) {
  if (
    sessionId !== undefined &&
    toolStatusSessionId !== sessionId
  ) {
    return;
  }

  if (
    toolTurnId !== undefined &&
    toolStatusTurnId !== toolTurnId
  ) {
    return;
  }

  if (toolStatusTimer) {
    clearInterval(toolStatusTimer);
    toolStatusTimer = null;
  }

  if (toolStatusElement) {
    toolStatusElement.remove();
    toolStatusElement = null;
  }

  toolStatusStartedAt = null;
  toolStatusSessionId = null;
  toolStatusTurnId = null;
}

export function bindControls(
  onConnect,
  onDisconnect,
  onResumeListening,
  onVoiceWake
) {
  els.connect.addEventListener("click", onConnect);
  els.disconnect.addEventListener("click", onDisconnect);
  els.resumeListening.addEventListener("click", onResumeListening);
  els.voiceWake.addEventListener("click", onVoiceWake);
  els.clear.addEventListener("click", clearTranscript);
}

function scrollTranscriptToBottom() {
  els.transcript.scrollTop = els.transcript.scrollHeight;
}
