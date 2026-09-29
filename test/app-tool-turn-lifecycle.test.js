import assert from "node:assert/strict";
import test from "node:test";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
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

  return elements;
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("cancels current Codex work, ignores its late completion, and preserves transcript supersession", async () => {
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
  const projectTestResponse = createDeferred();
  let codexRequestCount = 0;

  try {
    const elements = setUpBrowserEnvironment();
    globalThis.fetch = async (url) => {
      if (url === "/api/voice-token") {
        return { ok: true, json: async () => ({ token: "test-token" }) };
      }

      if (url === "/api/developer/tests") {
        return projectTestResponse.promise;
      }

      codexRequestCount++;
      return codexRequestCount === 1
        ? firstCodexResponse.promise
        : secondCodexResponse.promise;
    };

    await import(`../public/app.js?tool-turn-test=${Date.now()}`);
    await elements.get("connect").listeners.click();

    const socket = FakeWebSocket.instances.at(-1);
    socket.open();
    socket.receive({ type: "session.ready", session_id: "tool-turn-session" });

    socket.receive({
      type: "tool.call",
      name: "ask_codex",
      call_id: "original-codex-call",
      arguments: { task: "Inspect the repository." },
    });
    await flushPromises();

    socket.receive({
      type: "tool.call",
      name: "cancel_current_work",
      call_id: "cancel-call",
      arguments: {},
    });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    const cancellations = socket.sentMessages.filter(
      (message) => message.type === "tool.result"
    );
    assert.deepEqual(cancellations, [
      {
        type: "tool.result",
        call_id: "original-codex-call",
        result: JSON.stringify({
          success: false,
          cancelled: true,
          error: "Superseded by a newer user request.",
        }),
      },
      {
        type: "tool.result",
        call_id: "cancel-call",
        result: JSON.stringify({ success: true, cancelled: true }),
      },
    ]);
    assert.equal(socket.readyState, FakeWebSocket.OPEN);

    firstCodexResponse.resolve({
      ok: true,
      json: async () => ({ output: "This response is stale." }),
    });
    await flushPromises();

    assert.equal(
      socket.sentMessages.filter((message) => message.call_id === "original-codex-call").length,
      1
    );

    socket.receive({
      type: "tool.call",
      name: "ask_codex",
      call_id: "new-codex-call",
      arguments: { task: "Inspect the current request." },
    });
    socket.receive({ type: "reply.done", status: "completed" });
    secondCodexResponse.resolve({
      ok: true,
      json: async () => ({ output: "Current response." }),
    });
    await flushPromises();

    assert.deepEqual(
      socket.sentMessages.filter((message) => message.call_id === "new-codex-call"),
      [{
        type: "tool.result",
        call_id: "new-codex-call",
        result: JSON.stringify({ success: true, output: "Current response." }),
      }]
    );

    socket.receive({
      type: "tool.call",
      name: "cancel_current_work",
      call_id: "no-work-cancel-call",
      arguments: {},
    });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    assert.deepEqual(
      socket.sentMessages.filter(
        (message) => message.call_id === "no-work-cancel-call"
      ),
      [{
        type: "tool.result",
        call_id: "no-work-cancel-call",
        result: JSON.stringify({ success: true, cancelled: true }),
      }]
    );

    socket.receive({
      type: "tool.call",
      name: "ask_codex",
      call_id: "normal-order-codex-call",
      arguments: { task: "This call is superseded normally." },
    });
    await flushPromises();
    socket.receive({ type: "transcript.user", text: "A newer request." });

    assert.deepEqual(
      socket.sentMessages.filter(
        (message) => message.call_id === "normal-order-codex-call"
      ),
      [{
        type: "tool.result",
        call_id: "normal-order-codex-call",
        result: JSON.stringify({
          success: false,
          cancelled: true,
          error: "Superseded by a newer user request.",
        }),
      }]
    );

    socket.receive({
      type: "tool.call",
      name: "run_project_tests",
      call_id: "project-test-call",
      arguments: { command: "npm run dangerous" },
    });
    await flushPromises();
    const activityUpdate = socket.sentMessages
      .filter((message) => message.type === "session.update")
      .at(-1);

    assert.deepEqual(Object.keys(activityUpdate.session), ["system_prompt"]);
    assert.match(activityUpdate.session.system_prompt, /Running the project tests/);

    socket.receive({ type: "input.speech.started" });
    socket.receive({ type: "transcript.user.delta", text: "What's the Git" });
    socket.receive({ type: "transcript.user", text: "A newer request." });
    projectTestResponse.resolve({
      ok: true,
      json: async () => ({ success: true, completed: true, passed: true }),
    });
    await flushPromises();

    assert.deepEqual(
      socket.sentMessages.filter((message) => message.call_id === "project-test-call"),
      [{
        type: "tool.result",
        call_id: "project-test-call",
        result: JSON.stringify({
          success: false,
          cancelled: true,
          error: "Superseded by a newer user request.",
        }),
      }]
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
