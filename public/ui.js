const els = {
  connect: document.getElementById("connect"),
  disconnect: document.getElementById("disconnect"),
  clear: document.getElementById("clear"),
  voice: document.getElementById("voice"),
  prompt: document.getElementById("prompt"),
  greeting: document.getElementById("greeting"),
  transcript: document.getElementById("transcript"),
  empty: document.getElementById("empty"),
  statusDot: document.getElementById("status-dot"),
  statusText: document.getElementById("status-text"),
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

export function finalizeUserTranscript(text) {
  if (userPartialElement) {
    userPartialElement.classList.remove("partial");
    userPartialElement.textContent = text;
    userPartialElement = null;
    return;
  }

  addBubble("user", text);
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

  if (meta) {
    const metaElement = document.createElement("span");
    metaElement.className = "meta";
    metaElement.textContent = meta;
    bubble.appendChild(metaElement);
  }

  scrollTranscriptToBottom();
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

export function bindControls(onConnect, onDisconnect) {
  els.connect.addEventListener("click", onConnect);
  els.disconnect.addEventListener("click", onDisconnect);
  els.clear.addEventListener("click", clearTranscript);
}

function scrollTranscriptToBottom() {
  els.transcript.scrollTop = els.transcript.scrollHeight;
}
