import assert from "node:assert/strict";
import test from "node:test";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static instances = [];
  constructor() { this.readyState = FakeWebSocket.CONNECTING; this.sentMessages = []; FakeWebSocket.instances.push(this); }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  receive(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
  send(message) { this.sentMessages.push(JSON.parse(message)); }
}

function createElement() {
  return {
    addEventListener(type, listener) { this.listeners ??= {}; this.listeners[type] = listener; },
    appendChild(child) { child.parentNode = this; this.children ??= []; this.children.push(child); return child; },
    children: [], classList: { remove() {} }, disabled: false, hidden: true, parentNode: null,
    remove() {}, scrollHeight: 0, scrollTop: 0, textContent: "", value: "",
  };
}

async function flushPromises() { await new Promise((resolve) => setImmediate(resolve)); }

test("reports completed deterministic actions and clears them for a new session", async () => {
  const originals = {
    fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, document: globalThis.document,
    window: globalThis.window, navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    AudioWorkletNode: globalThis.AudioWorkletNode, capabilities: globalThis.__OFFSCREEN_CAPABILITIES__,
  };

  try {
    const elements = new Map();
    for (const id of ["connect", "disconnect", "voice-wake", "resume-listening", "clear", "voice", "prompt", "greeting", "transcript", "empty", "status-dot", "status-text", "hosted-demo-notice"]) elements.set(id, createElement());
    elements.get("empty").parentNode = elements.get("transcript");
    globalThis.document = { createElement, getElementById: (id) => elements.get(id) };
    globalThis.window = { AudioContext: class { constructor() { this.audioWorklet = { addModule: async () => {} }; this.currentTime = 0; } close() {} createMediaStreamSource() { return { connect() {}, disconnect() {} }; } } };
    globalThis.AudioWorkletNode = class { constructor() { this.port = {}; } disconnect() {} };
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } } });
    globalThis.WebSocket = FakeWebSocket;
    globalThis.__OFFSCREEN_CAPABILITIES__ = { isHostedDemo: false, calendar: true, codex: true, developerWorkspace: true, browserControl: true };
    globalThis.fetch = async (url) => {
      if (url === "/api/voice-token") return { ok: true, json: async () => ({ token: "test-token" }) };
      if (url === "/api/developer/git-status") return { ok: true, json: async () => ({ success: true, staged: [{ path: "public/app.js" }], unstaged: [], untracked: [] }) };
      throw new Error(`Unexpected request: ${url}`);
    };

    await import(`../public/app.js?session-activity-test=${Date.now()}`);
    await elements.get("connect").listeners.click();
    const socket = FakeWebSocket.instances.at(-1);
    socket.open();
    socket.receive({ type: "session.ready", session_id: "activity" });
    socket.receive({ type: "tool.call", name: "get_git_status", call_id: "status", arguments: {} });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();
    socket.receive({ type: "transcript.user", text: "What did you just do?" });
    socket.receive({ type: "tool.call", name: "get_session_activity", call_id: "activity", arguments: { limit: 1 } });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    const activityResult = socket.sentMessages.find((message) => message.call_id === "activity");
    assert.deepEqual(JSON.parse(activityResult.result).receipts, [{
      sequence: 1,
      tool: "get_git_status",
      status: "success",
      summary: "Checked Git status: 1 changed files.",
      target: {},
    }]);
  } finally {
    globalThis.fetch = originals.fetch; globalThis.WebSocket = originals.WebSocket;
    globalThis.document = originals.document; globalThis.window = originals.window;
    if (originals.navigator) Object.defineProperty(globalThis, "navigator", originals.navigator);
    else delete globalThis.navigator;
    globalThis.AudioWorkletNode = originals.AudioWorkletNode;
    globalThis.__OFFSCREEN_CAPABILITIES__ = originals.capabilities;
  }
});
