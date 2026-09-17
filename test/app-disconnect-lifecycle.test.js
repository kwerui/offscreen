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
    this.onclose?.({});
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
    "connect", "disconnect", "clear", "voice", "prompt", "greeting",
    "transcript", "empty", "status-dot", "status-text",
  ]) {
    elements.set(id, createElement());
  }

  elements.get("empty").parentNode = elements.get("transcript");
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

      close() {
        return Promise.resolve();
      }
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
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

test("sends a disconnect result before ending the session and reconnects normally", async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalAudioWorkletNode = globalThis.AudioWorkletNode;

  try {
    const elements = setUpBrowserEnvironment();
    globalThis.fetch = async (url) => {
      assert.equal(url, "/api/voice-token");
      return { ok: true, json: async () => ({ token: "test-token" }) };
    };

    await import(`../public/app.js?disconnect-test=${Date.now()}`);
    await elements.get("connect").listeners.click();

    const firstSocket = FakeWebSocket.instances.at(-1);
    firstSocket.open();
    firstSocket.receive({ type: "session.ready", session_id: "first" });
    firstSocket.receive({
      type: "tool.call",
      name: "disconnect_session",
      call_id: "disconnect-call",
      arguments: {},
    });
    await flushPromises();

    assert.equal(firstSocket.readyState, FakeWebSocket.OPEN);
    assert.deepEqual(firstSocket.sentMessages.filter(
      (message) => message.type === "tool.result"
    ), []);

    firstSocket.receive({ type: "reply.done", status: "completed" });

    assert.deepEqual(firstSocket.sentMessages.filter(
      (message) => message.type === "tool.result"
    ), [{
      type: "tool.result",
      call_id: "disconnect-call",
      result: JSON.stringify({ success: true, disconnected: true }),
    }]);
    assert.equal(firstSocket.readyState, FakeWebSocket.OPEN);

    await flushPromises();
    assert.equal(firstSocket.readyState, FakeWebSocket.CLOSED);

    await elements.get("connect").listeners.click();
    const secondSocket = FakeWebSocket.instances.at(-1);
    secondSocket.open();
    secondSocket.receive({ type: "session.ready", session_id: "second" });

    assert.equal(secondSocket.readyState, FakeWebSocket.OPEN);
    assert.equal(elements.get("disconnect").disabled, false);

    secondSocket.receive({
      type: "tool.call",
      name: "disconnect_session",
      call_id: "stale-disconnect-call",
      arguments: {},
    });
    await flushPromises();

    await elements.get("connect").listeners.click();
    const thirdSocket = FakeWebSocket.instances.at(-1);
    thirdSocket.open();
    thirdSocket.receive({ type: "session.ready", session_id: "third" });

    secondSocket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    assert.equal(thirdSocket.readyState, FakeWebSocket.OPEN);
    assert.deepEqual(thirdSocket.sentMessages.filter(
      (message) => message.type === "tool.result"
    ), []);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    Object.defineProperty(globalThis, "navigator", originalNavigator);
    globalThis.AudioWorkletNode = originalAudioWorkletNode;
  }
});
