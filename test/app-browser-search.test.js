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

  close() {
    this.readyState = 3;
    this.onclose?.();
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

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("searches through the fixed browser provider and preserves spoken result follow-up", async () => {
  const originals = {
    fetch: globalThis.fetch,
    WebSocket: globalThis.WebSocket,
    document: globalThis.document,
    window: globalThis.window,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    AudioWorkletNode: globalThis.AudioWorkletNode,
    capabilities: globalThis.__OFFSCREEN_CAPABILITIES__,
  };

  const browserRequests = [];

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

    globalThis.fetch = async (url, options = {}) => {
      if (url === "/api/voice-token") {
        return {
          ok: true,
          json: async () => ({ token: "test-token" }),
        };
      }

      if (url === "/api/browser") {
        const body = JSON.parse(options.body);
        browserRequests.push(body);

        if (body.action === "navigate") {
          return {
            ok: true,
            json: async () => ({ success: true, content: "Navigated" }),
          };
        }

        if (body.action === "snapshot") {
          return {
            ok: true,
            json: async () => ({
              success: true,
              content: [
                '- link "Search One" [ref=e10]',
                '- link "Search Two" [ref=e11]',
              ].join("\n"),
            }),
          };
        }

        if (body.action === "click") {
          return {
            ok: true,
            json: async () => ({ success: true, content: "Opened" }),
          };
        }
      }

      throw new Error("Unexpected request: " + url);
    };

    await import("../public/app.js?browser-search-test=" + Date.now());

    await elements.get("connect").listeners.click();
    const socket = FakeWebSocket.instances.at(-1);
    socket.open();
    socket.receive({ type: "session.ready", session_id: "browser-search" });

    socket.receive({
      type: "transcript.user",
      text: "Search the web for AssemblyAI voice agents.",
    });
    socket.receive({
      type: "tool.call",
      name: "browser_search_web",
      call_id: "search",
      arguments: { query: "AssemblyAI voice agents" },
    });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    const searchResult = socket.sentMessages.find(
      (message) => message.call_id === "search"
    );
    assert.ok(searchResult);
    assert.deepEqual(JSON.parse(searchResult.result), {
      success: true,
      query: "AssemblyAI voice agents",
      content: [
        '- link "Search One" [ref=e10]',
        '- link "Search Two" [ref=e11]',
      ].join("\n"),
    });

    assert.deepEqual(browserRequests.slice(0, 2), [
      {
        action: "navigate",
        url: "https://html.duckduckgo.com/html/?q=AssemblyAI%20voice%20agents",
      },
      { action: "snapshot" },
    ]);

    socket.receive({ type: "reply.started" });
    socket.receive({
      type: "transcript.agent",
      text: "I found Search Two first, then Search One.",
    });
    socket.receive({ type: "reply.done", status: "completed" });

    socket.receive({
      type: "transcript.user",
      text: "Open the first result.",
    });
    socket.receive({
      type: "tool.call",
      name: "browser_open_result",
      call_id: "open",
      arguments: { position: 1 },
    });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    assert.deepEqual(browserRequests.at(-1), {
      action: "click",
      target: "e11",
      element: "Search Two",
    });
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
