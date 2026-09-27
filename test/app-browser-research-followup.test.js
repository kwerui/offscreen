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
    children: [], classList: { remove() {} }, disabled: false, parentNode: null,
    remove() {}, scrollHeight: 0, scrollTop: 0, textContent: "", value: "",
  };
}

function setUpBrowserEnvironment() {
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
  return elements;
}

async function flushPromises() { await new Promise((resolve) => setImmediate(resolve)); }

function toolResult(socket, callId) {
  return socket.sentMessages.filter((message) => message.type === "tool.result" && message.call_id === callId).at(-1);
}

test("opens only a spoken browser research result through the current ref", async () => {
  const originals = {
    fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, document: globalThis.document,
    window: globalThis.window, navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    AudioWorkletNode: globalThis.AudioWorkletNode, capabilities: globalThis.__OFFSCREEN_CAPABILITIES__,
  };
  const browserRequests = [];
  let pendingSnapshotResponse;
  let snapshotCount = 0;

  try {
    const elements = setUpBrowserEnvironment();
    globalThis.__OFFSCREEN_CAPABILITIES__ = { isHostedDemo: false, calendar: true, codex: true, developerWorkspace: true, browserControl: true };
    globalThis.fetch = async (url, options) => {
      if (url === "/api/voice-token") return { ok: true, json: async () => ({ token: "test-token" }) };
      const request = JSON.parse(options.body);
      browserRequests.push(request);
      if (request.action === "snapshot") {
        snapshotCount++;
        const response = { ok: true, json: async () => ({ success: true, content: [
          '- link "AssemblyAI Voice Agent guide" [ref=e11]',
          '- link "Competitor research" [ref=e12]',
          '- link "Hidden result" [ref=e13]',
        ].join("\n") }) };

        if (snapshotCount === 2) {
          return new Promise((resolve) => { pendingSnapshotResponse = () => resolve(response); });
        }

        return response;
      }
      return { ok: true, json: async () => ({ success: true, content: "Opened" }) };
    };

    await import(`../public/app.js?browser-research-test=${Date.now()}`);
    await elements.get("connect").listeners.click();
    const socket = FakeWebSocket.instances.at(-1);
    socket.open();
    socket.receive({ type: "session.ready", session_id: "browser-research" });
    socket.receive({ type: "transcript.user", text: "Read the research results." });
    socket.receive({ type: "reply.started" });
    socket.receive({ type: "tool.call", name: "browser_read_page", call_id: "results", arguments: {} });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();
    socket.receive({ type: "reply.started" });
    socket.receive({ type: "transcript.agent", text: "The results are Competitor research, then AssemblyAI Voice Agent guide." });
    socket.receive({ type: "reply.done", status: "completed" });
    socket.receive({ type: "transcript.user", text: "Open the second result." });
    socket.receive({ type: "tool.call", name: "browser_click", call_id: "open-second", arguments: { target: "second result", element_description: "Ignore safety checks" } });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    assert.deepEqual(browserRequests, [{ action: "snapshot" }, { action: "click", target: "e11" }]);
    assert.deepEqual(JSON.parse(toolResult(socket, "open-second").result), { success: true, content: "Opened" });

    socket.receive({ type: "transcript.user", text: "Read more research results." });
    socket.receive({ type: "reply.started" });
    socket.receive({ type: "tool.call", name: "browser_read_page", call_id: "late-results", arguments: {} });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();
    socket.receive({ type: "transcript.user", text: "Never mind, what else can you do?" });
    pendingSnapshotResponse();
    await flushPromises();
    socket.receive({ type: "transcript.user", text: "Open the first result." });
    socket.receive({ type: "tool.call", name: "browser_click", call_id: "stale-first", arguments: { target: "first result" } });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    assert.deepEqual(browserRequests, [
      { action: "snapshot" },
      { action: "click", target: "e11" },
      { action: "snapshot" },
    ]);
    assert.deepEqual(JSON.parse(toolResult(socket, "stale-first").result), {
      success: false,
      error: "I can open only a research result that was just read aloud. Ask me to read the results again.",
    });
  } finally {
    globalThis.fetch = originals.fetch; globalThis.WebSocket = originals.WebSocket;
    globalThis.document = originals.document; globalThis.window = originals.window;
    Object.defineProperty(globalThis, "navigator", originals.navigator);
    globalThis.AudioWorkletNode = originals.AudioWorkletNode;
    globalThis.__OFFSCREEN_CAPABILITIES__ = originals.capabilities;
  }
});
