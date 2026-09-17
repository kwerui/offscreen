import assert from "node:assert/strict";
import test from "node:test";
import { VOICE_TOOLS } from "../public/tools.js";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  static instances = [];

  constructor() {
    this.readyState = FakeWebSocket.CONNECTING;
    this.sentMessages = [];
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(event) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }

  send(message) {
    this.sentMessages.push(JSON.parse(message));
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({});
  }
}

function createDeferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

function createElement() {
  return {
    addEventListener(type, listener) {
      this.listeners ??= {};
      this.listeners[type] = listener;
    },
    appendChild(child) {
      child.parentNode = this;
      this.children ??= [];
      this.children.push(child);
      return child;
    },
    children: [],
    classList: { remove() {} },
    className: "",
    disabled: false,
    parentNode: null,
    remove() {},
    scrollHeight: 0,
    scrollTop: 0,
    textContent: "",
    value: "",
  };
}

function setUpBrowserEnvironment() {
  const elements = new Map();
  for (const id of [
    "connect", "disconnect", "resume-listening", "clear", "voice", "prompt",
    "greeting", "transcript", "empty", "status-dot", "status-text",
  ]) {
    elements.set(id, createElement());
  }

  globalThis.document = {
    createElement,
    getElementById: (id) => elements.get(id),
  };
  globalThis.window = {
    AudioContext: class {
      constructor() {
        this.audioWorklet = { addModule: async () => {} };
        this.currentTime = 0;
      }

      close() { return Promise.resolve(); }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    },
  };
  globalThis.AudioWorkletNode = class {
    constructor() {
      this.port = {};
    }

    disconnect() {}
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
  });
  globalThis.WebSocket = FakeWebSocket;

  return elements;
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
}

function findToolResult(socket, callId) {
  const message = socket.sentMessages.find(
    (item) => item.type === "tool.result" && item.call_id === callId
  );

  return message && JSON.parse(message.result);
}

function latestSessionUpdate(socket) {
  return socket.sentMessages.filter(
    (message) => message.type === "session.update"
  ).at(-1);
}

test("keeps standby client-controlled while unrelated speech and Codex work continue", async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalAudioWorkletNode = globalThis.AudioWorkletNode;
  const codexResponse = createDeferred();
  let codexFetchCalls = 0;

  try {
    const elements = setUpBrowserEnvironment();
    globalThis.fetch = async (url) => {
      if (url === "/api/voice-token") {
        return { ok: true, json: async () => ({ token: "test-token" }) };
      }

      codexFetchCalls++;
      return codexResponse.promise;
    };

    await import(`../public/app.js?standby-test=${Date.now()}`);
    await elements.get("connect").listeners.click();
    const firstSocket = FakeWebSocket.instances.at(-1);
    firstSocket.open();
    firstSocket.receive({ type: "session.ready", session_id: "first" });

    firstSocket.receive({
      type: "tool.call",
      name: "ask_codex",
      call_id: "codex-call",
      arguments: { task: "Inspect this project." },
    });
    await flushPromises();
    firstSocket.receive({
      type: "tool.call",
      name: "pause_listening",
      call_id: "pause-call",
      arguments: {},
    });
    firstSocket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    assert.equal(elements.get("resume-listening").disabled, false);
    assert.equal(
      elements.get("status-text").textContent,
      'Standby — audio is still transcribed for “resume listening” or “disconnect”; other speech is ignored.'
    );
    assert.match(latestSessionUpdate(firstSocket).session.system_prompt, /You are in standby/);
    assert.deepEqual(latestSessionUpdate(firstSocket).session.tools, []);

    const sessionUpdateCount = firstSocket.sentMessages.filter(
      (message) => message.type === "session.update"
    ).length;
    const transcriptBubbleCount = elements.get("transcript").children.length;
    firstSocket.receive({ type: "transcript.user", text: "ten plus ten" });
    firstSocket.receive({ type: "reply.started" });
    firstSocket.receive({ type: "reply.audio", data: "AQAA" });
    firstSocket.receive({ type: "transcript.agent", text: "Ten plus ten is twenty." });
    firstSocket.receive({
      type: "tool.call",
      name: "ask_codex",
      call_id: "standby-codex-call",
      arguments: { task: "This must not run." },
    });
    firstSocket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    // A rejected tool result can cause the Voice Agent to generate another
    // reply. Standby suppression must remain active across that follow-up too.
    firstSocket.receive({ type: "reply.started" });
    firstSocket.receive({ type: "reply.audio", data: "AQAA" });
    firstSocket.receive({ type: "transcript.agent", text: "I cannot run that." });
    firstSocket.receive({ type: "reply.done", status: "completed" });

    assert.equal(elements.get("resume-listening").disabled, false);
    assert.equal(
      elements.get("status-text").textContent,
      'Standby — audio is still transcribed for “resume listening” or “disconnect”; other speech is ignored.'
    );
    assert.equal(
      firstSocket.sentMessages.filter((message) => message.type === "session.update").length,
      sessionUpdateCount
    );
    assert.equal(elements.get("transcript").children.length, transcriptBubbleCount + 1);
    const ignoredBubble = elements.get("transcript").children.at(-1);
    assert.equal(ignoredBubble.children.at(-1)?.className, "meta");
    assert.equal(ignoredBubble.children.at(-1)?.textContent, "ignored in standby");
    assert.equal(codexFetchCalls, 1);

    for (const ignoredText of ["okay", "continue"]) {
      firstSocket.receive({ type: "transcript.user", text: ignoredText });
      firstSocket.receive({ type: "reply.done", status: "completed" });
    }
    assert.equal(elements.get("resume-listening").disabled, false);

    codexResponse.resolve({ ok: true, json: async () => ({ output: "Complete." }) });
    await flushPromises();
    assert.deepEqual(findToolResult(firstSocket, "pause-call"), { success: true, standby: true });
    assert.deepEqual(findToolResult(firstSocket, "codex-call"), { success: true, output: "Complete." });
    assert.deepEqual(findToolResult(firstSocket, "standby-codex-call"), {
      success: false,
      error: "Tool calls are unavailable while Offscreen is in standby.",
    });

    firstSocket.receive({ type: "transcript.user", text: "resume listening" });
    const resumeBubble = elements.get("transcript").children.at(-1);
    assert.equal(resumeBubble.children.some((child) => child.textContent === "ignored in standby"), false);
    assert.equal(elements.get("resume-listening").disabled, true);
    assert.equal(elements.get("status-text").textContent, "Connected");
    assert.deepEqual(latestSessionUpdate(firstSocket).session.tools, VOICE_TOOLS);
    assert.doesNotMatch(latestSessionUpdate(firstSocket).session.system_prompt, /You are in standby/);

    // Leaving standby clears reply suppression so normal agent output is shown.
    const bubbleCountAfterResume = elements.get("transcript").children.length;
    firstSocket.receive({ type: "reply.started" });
    firstSocket.receive({ type: "transcript.agent", text: "Listening again." });
    firstSocket.receive({ type: "reply.done", status: "completed" });
    assert.equal(elements.get("transcript").children.length, bubbleCountAfterResume + 1);

    // If resume happens while an ignored standby reply is still open, the old
    // reply stays suppressed until its reply.done, then normal output resumes.
    firstSocket.receive({
      type: "tool.call",
      name: "pause_listening",
      call_id: "pause-for-overlap-call",
      arguments: {},
    });
    firstSocket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();
    firstSocket.receive({ type: "transcript.user", text: "ignore this" });
    firstSocket.receive({ type: "reply.started" });
    const bubbleCountBeforeOverlapResume = elements.get("transcript").children.length;
    firstSocket.receive({ type: "transcript.user", text: "resume listening" });
    firstSocket.receive({ type: "transcript.agent", text: "Late standby reply." });
    assert.equal(elements.get("transcript").children.length, bubbleCountBeforeOverlapResume + 1);
    firstSocket.receive({ type: "reply.done", status: "interrupted" });
    firstSocket.receive({ type: "reply.started" });
    firstSocket.receive({ type: "transcript.agent", text: "Listening again after interruption." });
    firstSocket.receive({ type: "reply.done", status: "completed" });
    assert.equal(elements.get("transcript").children.length, bubbleCountBeforeOverlapResume + 2);

    firstSocket.receive({
      type: "tool.call",
      name: "pause_listening",
      call_id: "pause-for-ui-call",
      arguments: {},
    });
    firstSocket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();
    elements.get("resume-listening").listeners.click();
    assert.equal(elements.get("resume-listening").disabled, true);
    assert.equal(elements.get("status-text").textContent, "Connected");

    firstSocket.receive({
      type: "tool.call",
      name: "pause_listening",
      call_id: "pause-for-disconnect-call",
      arguments: {},
    });
    firstSocket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();
    firstSocket.receive({ type: "transcript.user", text: "disconnect" });
    assert.equal(firstSocket.readyState, FakeWebSocket.CLOSED);

    await elements.get("connect").listeners.click();
    const secondSocket = FakeWebSocket.instances.at(-1);
    secondSocket.open();
    secondSocket.receive({ type: "session.ready", session_id: "second" });
    secondSocket.receive({
      type: "tool.call",
      name: "pause_listening",
      call_id: "second-pause-call",
      arguments: {},
    });
    secondSocket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();
    firstSocket.receive({ type: "transcript.user", text: "resume listening" });

    assert.equal(elements.get("resume-listening").disabled, false);
    assert.match(latestSessionUpdate(secondSocket).session.system_prompt, /You are in standby/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    Object.defineProperty(globalThis, "navigator", originalNavigator);
    globalThis.AudioWorkletNode = originalAudioWorkletNode;
  }
});
