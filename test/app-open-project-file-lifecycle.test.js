import assert from "node:assert/strict";
import test from "node:test";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static instances = [];

  constructor() {
    this.readyState = FakeWebSocket.CONNECTING;
    this.sentMessages = [];
    FakeWebSocket.instances.push(this);
  }

  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  receive(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
  send(message) { this.sentMessages.push(JSON.parse(message)); }
}

function createElement() {
  return {
    addEventListener(type, listener) { this.listeners ??= {}; this.listeners[type] = listener; },
    appendChild(child) { child.parentNode = this; this.children ??= []; this.children.push(child); return child; },
    children: [],
    classList: { remove() {} },
    disabled: false,
    hidden: true,
    parentNode: null,
    remove() {},
    scrollHeight: 0,
    scrollTop: 0,
    textContent: "",
    value: "",
  };
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("does not repeat a denied project file opening backend attempt within one user turn", async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalAudioWorkletNode = globalThis.AudioWorkletNode;
  const originalCapabilities = globalThis.__OFFSCREEN_CAPABILITIES__;
  let openRequestCount = 0;

  try {
    const elements = new Map();
    for (const id of ["connect", "disconnect", "voice-wake", "resume-listening", "clear", "voice", "prompt", "greeting", "transcript", "empty", "status-dot", "status-text", "hosted-demo-notice"]) {
      elements.set(id, createElement());
    }
    elements.get("empty").parentNode = elements.get("transcript");
    globalThis.document = { createElement, getElementById: (id) => elements.get(id) };
    globalThis.window = { AudioContext: class { constructor() { this.audioWorklet = { addModule: async () => {} }; this.currentTime = 0; } close() {} createMediaStreamSource() { return { connect() {}, disconnect() {} }; } } };
    globalThis.AudioWorkletNode = class { constructor() { this.port = {}; } disconnect() {} };
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } } });
    globalThis.WebSocket = FakeWebSocket;
    globalThis.__OFFSCREEN_CAPABILITIES__ = { isHostedDemo: false, calendar: true, codex: true, developerWorkspace: true, browserControl: true };
    globalThis.fetch = async (url) => {
      if (url === "/api/voice-token") return { ok: true, json: async () => ({ token: "test-token" }) };
      if (url === "/api/developer/open-file") {
        openRequestCount++;
        return { ok: false, json: async () => ({ success: false, error: "file_not_allowed" }) };
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    await import(`../public/app.js?denied-open-test=${Date.now()}`);
    await elements.get("connect").listeners.click();
    const socket = FakeWebSocket.instances.at(-1);
    socket.open();
    socket.receive({ type: "session.ready", session_id: "denied-open-session" });
    socket.receive({ type: "transcript.user", text: "Open .env" });
    socket.receive({ type: "tool.call", name: "open_project_file", call_id: "denied-open-call", arguments: { path: ".env" } });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    assert.equal(openRequestCount, 1);
    assert.deepEqual(socket.sentMessages.filter((message) => message.call_id === "denied-open-call"), [{
      type: "tool.result",
      call_id: "denied-open-call",
      result: JSON.stringify({ success: false, error: "file_not_allowed", terminal: true }),
    }]);

    socket.receive({ type: "tool.call", name: "open_project_file", call_id: "duplicate-denied-open-call", arguments: { path: ".env" } });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();
    assert.equal(openRequestCount, 1);

    socket.receive({ type: "transcript.user", text: "Open .env again" });
    socket.receive({ type: "tool.call", name: "open_project_file", call_id: "new-user-turn-denied-open-call", arguments: { path: ".env" } });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();
    assert.equal(openRequestCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    Object.defineProperty(globalThis, "navigator", originalNavigator);
    globalThis.AudioWorkletNode = originalAudioWorkletNode;
    globalThis.__OFFSCREEN_CAPABILITIES__ = originalCapabilities;
  }
});
