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

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("preserves evidence and spoken browser context across a mixed-domain session", async () => {
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

      if (url === "/api/developer/git-status") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            staged: [],
            unstaged: [{ path: "public/app.js" }],
            untracked: [],
          }),
        };
      }

      if (url === "/api/calendar/query?when=today") {
        return {
          ok: true,
          json: async () => ({
            timezone: "Europe/London",
            events: [{ title: "Hackathon check-in" }],
          }),
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
                '- link "AssemblyAI Docs" [ref=e20]',
                '- link "Voice Agent Guide" [ref=e21]',
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

    await import("../public/app.js?combined-workflow-test=" + Date.now());

    await elements.get("connect").listeners.click();
    const socket = FakeWebSocket.instances.at(-1);
    socket.open();
    socket.receive({ type: "session.ready", session_id: "combined" });

    socket.receive({ type: "transcript.user", text: "What's my Git status?" });
    socket.receive({
      type: "tool.call",
      name: "get_git_status",
      call_id: "git",
      arguments: {},
    });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

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

    socket.receive({ type: "reply.started" });
    socket.receive({
      type: "transcript.agent",
      text: "I found AssemblyAI Docs first, and Voice Agent Guide second.",
    });
    socket.receive({ type: "reply.done", status: "completed" });

    socket.receive({
      type: "transcript.user",
      text: "What do I have today?",
    });
    socket.receive({
      type: "tool.call",
      name: "get_calendar_events",
      call_id: "calendar",
      arguments: { when: "today" },
    });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    socket.receive({
      type: "transcript.user",
      text: "What have you done so far?",
    });
    socket.receive({
      type: "tool.call",
      name: "get_session_activity",
      call_id: "activity",
      arguments: { limit: 5 },
    });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    const activityResult = socket.sentMessages.find(
      (message) => message.call_id === "activity"
    );
    assert.ok(activityResult);

    const receipts = JSON.parse(activityResult.result).receipts;
    assert.deepEqual(
      receipts.map((receipt) => ({
        tool: receipt.tool,
        status: receipt.status,
        summary: receipt.summary,
      })),
      [
        {
          tool: "get_git_status",
          status: "success",
          summary: "Checked Git status: 1 changed files.",
        },
        {
          tool: "browser_search_web",
          status: "success",
          summary: "Searched the public web.",
        },
        {
          tool: "get_calendar_events",
          status: "success",
          summary: "Checked Calendar: 1 events.",
        },
      ]
    );

    socket.receive({
      type: "transcript.user",
      text: "Open the second result.",
    });
    socket.receive({
      type: "tool.call",
      name: "browser_open_result",
      call_id: "open-result",
      arguments: { position: 2 },
    });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    assert.deepEqual(browserRequests.at(-1), {
      action: "click",
      target: "e21",
      element: "Voice Agent Guide",
    });

    const openResult = socket.sentMessages.find(
      (message) => message.call_id === "open-result"
    );
    assert.ok(openResult);
    assert.equal(JSON.parse(openResult.result).success, true);

    assert.equal(elements.get("activity-count").textContent, "4 recent");
    assert.equal(
      elements.get("activity-list").children[0].children[1].children[0].textContent,
      "Opened a spoken browser result."
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
