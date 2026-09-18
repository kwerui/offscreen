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

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: 1000 });
  }
}

class FakeSpeechRecognition {
  static instances = [];

  constructor() {
    this.startCalls = 0;
    this.stopCalls = 0;
    FakeSpeechRecognition.instances.push(this);
  }

  start() {
    this.startCalls++;
  }

  stop() {
    this.stopCalls++;
  }

  receiveTranscript(text) {
    const result = [{ transcript: text }];
    result.isFinal = true;
    this.onresult?.({ resultIndex: 0, results: [result] });
  }

  end() {
    this.onend?.();
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
    "connect", "disconnect", "voice-wake", "resume-listening", "clear",
    "voice", "prompt", "greeting", "transcript", "empty", "status-dot",
    "status-text",
  ]) {
    elements.set(id, createElement());
  }

  elements.get("empty").parentNode = elements.get("transcript");

  globalThis.document = {
    createElement,
    getElementById: (id) => elements.get(id),
  };
  globalThis.window = {
    SpeechRecognition: FakeSpeechRecognition,
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
    value: {
      mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) },
    },
  });
  globalThis.WebSocket = FakeWebSocket;

  return elements;
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("voice wake connects only on the wake phrase and restarts after disconnect", async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalAudioWorkletNode = globalThis.AudioWorkletNode;

  try {
    FakeWebSocket.instances = [];
    FakeSpeechRecognition.instances = [];
    const elements = setUpBrowserEnvironment();

    globalThis.fetch = async (url) => {
      assert.equal(url, "/api/voice-token");
      return { ok: true, json: async () => ({ token: "test-token" }) };
    };

    await import(`../public/app.js?voice-wake-test=${Date.now()}`);

    assert.equal(elements.get("voice-wake").textContent, "Enable voice wake");
    assert.equal(elements.get("voice-wake").disabled, false);

    elements.get("voice-wake").listeners.click();

    const recognition = FakeSpeechRecognition.instances.at(-1);
    assert.ok(recognition);
    assert.equal(recognition.startCalls, 1);
    assert.equal(FakeSpeechRecognition.instances.length, 1);
    assert.equal(elements.get("voice-wake").textContent, "Disable voice wake");
    assert.equal(
      elements.get("status-text").textContent,
      'Disconnected — browser speech recognition is listening for “Connect Offscreen”'
    );

    recognition.receiveTranscript("connect");
    await flushPromises();
    assert.equal(FakeWebSocket.instances.length, 0);

    recognition.receiveTranscript("Connect Offscreen.");
    recognition.end();
    await flushPromises();

    assert.equal(recognition.stopCalls, 1);
    assert.equal(FakeWebSocket.instances.length, 1);
    assert.equal(elements.get("voice-wake").disabled, true);

    const socket = FakeWebSocket.instances.at(-1);
    socket.open();
    socket.receive({ type: "session.ready", session_id: "wake-session" });

    assert.equal(elements.get("status-text").textContent, "Connected (wake-session)");
    assert.equal(elements.get("voice-wake").textContent, "Disable voice wake");
    assert.equal(elements.get("voice-wake").disabled, false);
    assert.equal(FakeSpeechRecognition.instances.length, 1);

    elements.get("disconnect").listeners.click();

    assert.equal(socket.readyState, FakeWebSocket.CLOSED);
    assert.equal(recognition.startCalls, 2);
    assert.equal(
      elements.get("status-text").textContent,
      'Disconnected — browser speech recognition is listening for “Connect Offscreen”'
    );

    elements.get("voice-wake").listeners.click();

    assert.equal(elements.get("voice-wake").textContent, "Enable voice wake");
    assert.equal(elements.get("status-text").textContent, "Disconnected");
    assert.equal(recognition.stopCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    Object.defineProperty(globalThis, "navigator", originalNavigator);
    globalThis.AudioWorkletNode = originalAudioWorkletNode;
  }
});
