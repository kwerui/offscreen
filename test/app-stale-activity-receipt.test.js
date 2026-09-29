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
    replaceChildren(...children) {
      this.children = children;
      for (const child of children) child.parentNode = this;
    },
    children: [],
    classList: { remove() {} },
    disabled: false,
    hidden: true,
    parentNode: null,
    remove() {},
    setAttribute() {},
    scrollHeight: 0,
    scrollTop: 0,
    textContent: "",
    value: "",
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("terminalizes a superseded action receipt and ignores its late result", async () => {
  const originals = {
    fetch: globalThis.fetch,
    WebSocket: globalThis.WebSocket,
    document: globalThis.document,
    window: globalThis.window,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    AudioWorkletNode: globalThis.AudioWorkletNode,
    capabilities: globalThis.__OFFSCREEN_CAPABILITIES__,
  };

  const browserResponse = deferred();

  try {
    FakeWebSocket.instances = [];
    const elements = new Map();

    for (const id of [
      "connect",
      "disconnect",
      "voice-wake",
      "resume-listening",
      "clear",
      "voice",
      "prompt",
      "greeting",
      "transcript",
      "empty",
      "status-dot",
      "status-text",
      "hosted-demo-notice",
      "activity-list",
      "activity-count",
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
        close() {}
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
        mediaDevices: {
          getUserMedia: async () => ({ getTracks: () => [] }),
        },
      },
    });

    globalThis.WebSocket = FakeWebSocket;
    globalThis.__OFFSCREEN_CAPABILITIES__ = {
      isHostedDemo: false,
      calendar: true,
      codex: true,
      developerWorkspace: true,
      browserControl: true,
    };

    globalThis.fetch = async (url) => {
      if (url === "/api/voice-token") {
        return {
          ok: true,
          json: async () => ({ token: "test-token" }),
        };
      }

      if (url === "/api/browser") {
        return browserResponse.promise;
      }

      throw new Error("Unexpected request: " + url);
    };

    await import("../public/app.js?stale-activity-receipt-test=" + Date.now());

    await elements.get("connect").listeners.click();
    const socket = FakeWebSocket.instances.at(-1);
    socket.open();
    socket.receive({ type: "session.ready", session_id: "stale-receipt" });

    socket.receive({
      type: "tool.call",
      name: "browser_read_page",
      call_id: "slow-browser",
      arguments: {},
    });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    assert.equal(elements.get("activity-count").textContent, "1 recent");

    socket.receive({
      type: "transcript.user",
      text: "What did you just do?",
    });
    socket.receive({
      type: "tool.call",
      name: "get_session_activity",
      call_id: "activity-1",
      arguments: { limit: 1 },
    });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    const firstActivity = socket.sentMessages.find(
      (message) => message.call_id === "activity-1"
    );
    assert.ok(firstActivity);
    assert.deepEqual(JSON.parse(firstActivity.result).receipts, [
      {
        sequence: 1,
        tool: "browser_read_page",
        status: "cancelled",
        summary: "The action was superseded before its result could be used.",
        target: {},
      },
    ]);

    browserResponse.resolve({
      ok: true,
      json: async () => ({
        success: true,
        content: '- link "Late result" [ref=e1]',
      }),
    });
    await flushPromises();

    assert.equal(
      socket.sentMessages.some((message) => message.call_id === "slow-browser"),
      false
    );

    socket.receive({
      type: "transcript.user",
      text: "What have you done so far?",
    });
    socket.receive({
      type: "tool.call",
      name: "get_session_activity",
      call_id: "activity-2",
      arguments: { limit: 1 },
    });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    const secondActivity = socket.sentMessages.find(
      (message) => message.call_id === "activity-2"
    );
    assert.ok(secondActivity);
    assert.deepEqual(
      JSON.parse(secondActivity.result).receipts,
      JSON.parse(firstActivity.result).receipts
    );
  } finally {
    globalThis.fetch = originals.fetch;
    globalThis.WebSocket = originals.WebSocket;
    globalThis.document = originals.document;
    globalThis.window = originals.window;

    if (originals.navigator) {
      Object.defineProperty(globalThis, "navigator", originals.navigator);
    } else {
      delete globalThis.navigator;
    }

    globalThis.AudioWorkletNode = originals.AudioWorkletNode;
    globalThis.__OFFSCREEN_CAPABILITIES__ = originals.capabilities;
  }
});
