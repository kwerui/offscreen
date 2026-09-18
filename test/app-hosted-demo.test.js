import assert from "node:assert/strict";
import test from "node:test";

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
    hidden: true,
    parentNode: null,
    remove() {},
    scrollHeight: 0,
    scrollTop: 0,
    textContent: "",
    value: "",
  };
}

test("HOSTED_DEMO registers only hosted tools, uses a hosted prompt, and shows its notice", async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalAudioWorkletNode = globalThis.AudioWorkletNode;
  const originalCapabilities = globalThis.__OFFSCREEN_CAPABILITIES__;

  try {
    const elements = new Map();
    for (const id of [
      "connect", "disconnect", "voice-wake", "resume-listening", "clear", "voice", "prompt",
      "greeting", "transcript", "empty", "status-dot", "status-text", "hosted-demo-notice",
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
      constructor() { this.port = {}; }
      disconnect() {}
    };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
    });
    globalThis.WebSocket = FakeWebSocket;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ token: "test-token" }) });
    globalThis.__OFFSCREEN_CAPABILITIES__ = {
      isHostedDemo: true,
      calendar: false,
      codex: false,
      browserControl: false,
    };

    await import(`../public/app.js?hosted-demo-test=${Date.now()}`);
    await elements.get("connect").listeners.click();
    const socket = FakeWebSocket.instances.at(-1);
    socket.open();
    socket.receive({ type: "session.ready", session_id: "hosted" });

    const sessionUpdate = socket.sentMessages.find(
      (message) => message.type === "session.update"
    );
    const toolNames = sessionUpdate.session.tools.map((tool) => tool.name);

    assert.deepEqual(toolNames.sort(), [
      "cancel_current_work",
      "disconnect_session",
      "open_website",
      "pause_listening",
      "repeat_last_response",
      "summarize_last_response",
    ].sort());
    assert.doesNotMatch(sessionUpdate.session.system_prompt, /calendar|codex|playwright|browser_navigate/i);
    assert.equal(elements.get("hosted-demo-notice").hidden, false);
    assert.equal(elements.get("prompt").disabled, true);
    assert.equal(elements.get("prompt").value, sessionUpdate.session.system_prompt.split("\n\n")[0]);
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
