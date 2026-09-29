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
    remove() {
      if (!this.parentNode) {
        return;
      }

      this.parentNode.children = this.parentNode.children.filter(
        (child) => child !== this
      );
      this.parentNode = null;
    },
    scrollHeight: 0,
    scrollTop: 0,
    textContent: "",
    value: "",
  };
}

function setUpBrowserEnvironment() {
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
  ]) {
    elements.set(id, createElement());
  }

  elements.get("empty").parentNode = elements.get("transcript");
  elements.get("transcript").children.push(elements.get("empty"));

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

function latestSessionUpdate(socket) {
  return socket.sentMessages.filter(
    (message) => message.type === "session.update"
  ).at(-1);
}

function toolResults(socket, callId) {
  return socket.sentMessages.filter(
    (message) => message.type === "tool.result" && message.call_id === callId
  );
}

test("reports current async activity without superseding it and preserves normal supersession", async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator"
  );
  const originalAudioWorkletNode = globalThis.AudioWorkletNode;
  const firstCodexResponse = createDeferred();
  const secondCodexResponse = createDeferred();
  const calendarResponse = createDeferred();
  let codexRequestCount = 0;

  try {
    FakeWebSocket.instances = [];
    const elements = setUpBrowserEnvironment();

    globalThis.fetch = async (url) => {
      if (url === "/api/voice-token") {
        return { ok: true, json: async () => ({ token: "test-token" }) };
      }

      if (url === "/api/codex") {
        codexRequestCount++;
        return codexRequestCount === 1
          ? firstCodexResponse.promise
          : secondCodexResponse.promise;
      }

      if (url.startsWith("/api/calendar/query?when=")) {
        return calendarResponse.promise;
      }

      throw new Error(`Unexpected request: ${url}`);
    };

    await import(`../public/app.js?current-activity-test=${Date.now()}`);
    await elements.get("connect").listeners.click();

    const socket = FakeWebSocket.instances.at(-1);
    socket.open();
    socket.receive({ type: "session.ready", session_id: "activity-session" });

    const initialPrompt = latestSessionUpdate(socket).session.system_prompt;
    assert.match(
      initialPrompt,
      /Current Offscreen activity: Nothing is running right now\./
    );
    assert.match(
      initialPrompt,
      /answer only from the Current Offscreen activity context/
    );

    socket.receive({
      type: "tool.call",
      name: "ask_codex",
      call_id: "first-codex-call",
      arguments: { task: "Inspect this project." },
    });
    await flushPromises();

    assert.match(
      latestSessionUpdate(socket).session.system_prompt,
      /Current Offscreen activity: Codex is checking your project\./
    );

    socket.receive({ type: "reply.done", status: "completed" });
    socket.receive({ type: "transcript.user", text: "What you're doing?" });
    await flushPromises();

    assert.equal(toolResults(socket, "first-codex-call").length, 0);
    assert.equal(codexRequestCount, 1);
    assert.match(
      latestSessionUpdate(socket).session.system_prompt,
      /Current Offscreen activity: Codex is checking your project\./
    );

    socket.receive({ type: "reply.started" });
    socket.receive({
      type: "transcript.agent",
      text: "I'm checking your project with Codex.",
    });
    socket.receive({ type: "reply.done", status: "completed" });

    firstCodexResponse.resolve({
      ok: true,
      json: async () => ({ output: "Inspection complete." }),
    });
    await flushPromises();

    assert.equal(toolResults(socket, "first-codex-call").length, 1);
    assert.deepEqual(
      JSON.parse(toolResults(socket, "first-codex-call")[0].result),
      { success: true, output: "Inspection complete." }
    );
    assert.match(
      latestSessionUpdate(socket).session.system_prompt,
      /Current Offscreen activity: Nothing is running right now\./
    );

    socket.receive({
      type: "tool.call",
      name: "ask_codex",
      call_id: "second-codex-call",
      arguments: { task: "Inspect something else." },
    });
    await flushPromises();
    socket.receive({ type: "reply.done", status: "completed" });
    socket.receive({ type: "transcript.user", text: "Open GitHub." });
    await flushPromises();

    assert.equal(toolResults(socket, "second-codex-call").length, 1);
    assert.deepEqual(
      JSON.parse(toolResults(socket, "second-codex-call")[0].result),
      {
        success: false,
        cancelled: true,
        error: "Superseded by a newer user request.",
      }
    );
    assert.match(
      latestSessionUpdate(socket).session.system_prompt,
      /Current Offscreen activity: Nothing is running right now\./
    );

    secondCodexResponse.resolve({
      ok: true,
      json: async () => ({ output: "This result is stale." }),
    });
    await flushPromises();
    assert.equal(toolResults(socket, "second-codex-call").length, 1);

    socket.receive({
      type: "tool.call",
      name: "get_calendar_events",
      call_id: "calendar-call",
      arguments: { when: "today" },
    });
    await flushPromises();

    assert.match(
      latestSessionUpdate(socket).session.system_prompt,
      /Current Offscreen activity: Checking your calendar\./
    );

    socket.receive({ type: "reply.done", status: "completed" });
    calendarResponse.resolve({
      ok: true,
      json: async () => ({ timezone: "UTC", events: [] }),
    });
    await flushPromises();

    assert.match(
      latestSessionUpdate(socket).session.system_prompt,
      /Current Offscreen activity: Nothing is running right now\./
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
    globalThis.AudioWorkletNode = originalAudioWorkletNode;
  }
});
