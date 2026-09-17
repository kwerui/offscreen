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
    "connect", "disconnect", "resume-listening", "clear", "voice", "prompt", "greeting",
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

function repeatLastResponse(socket, callId) {
  requestPreviousResponse(socket, "repeat_last_response", callId);
}

function summarizeLastResponse(socket, callId) {
  requestPreviousResponse(socket, "summarize_last_response", callId);
}

function requestPreviousResponse(socket, toolName, callId) {
  socket.receive({
    type: "tool.call",
    name: toolName,
    call_id: callId,
    arguments: {},
  });
  socket.receive({ type: "reply.done", status: "completed" });
}

function findToolResult(socket, callId) {
  const message = socket.sentMessages.find(
    (sentMessage) => sentMessage.call_id === callId
  );

  return JSON.parse(message.result);
}

test("repeats only the latest completed agent response and resets it between sessions", async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalAudioWorkletNode = globalThis.AudioWorkletNode;
  let fetchCount = 0;
  let calendarRequestCount = 0;

  try {
    const elements = setUpBrowserEnvironment();
    globalThis.fetch = async (url) => {
      if (url === "/api/voice-token") {
        fetchCount++;
        return { ok: true, json: async () => ({ token: "test-token" }) };
      }

      if (url.startsWith("/api/calendar/query?when=")) {
        calendarRequestCount++;
        return {
          ok: true,
          json: async () => ({ timezone: "UTC", events: [] }),
        };
      }

      throw new Error(`Unexpected request: ${url}`);
    };

    await import(`../public/app.js?repeat-test=${Date.now()}`);
    await elements.get("connect").listeners.click();
    const firstSocket = FakeWebSocket.instances.at(-1);
    firstSocket.open();

    const sessionUpdate = firstSocket.sentMessages.find(
      (message) => message.type === "session.update"
    );
    assert.match(
      sessionUpdate.session.system_prompt,
      /When repeat_last_response succeeds, speak the returned response exactly/
    );
    assert.match(
      sessionUpdate.session.system_prompt,
      /ALWAYS call repeat_last_response rather than repeating from conversation memory/
    );
    assert.match(
      sessionUpdate.session.system_prompt,
      /ALWAYS call summarize_last_response rather than summarizing from conversation memory/
    );

    repeatLastResponse(firstSocket, "no-response-call");
    await flushPromises();
    assert.deepEqual(findToolResult(firstSocket, "no-response-call"), {
      success: false,
      error: "No completed Offscreen response is available in this session.",
    });
    assert.equal(fetchCount, 1);

    summarizeLastResponse(firstSocket, "no-response-summary-call");
    await flushPromises();
    assert.deepEqual(findToolResult(firstSocket, "no-response-summary-call"), {
      success: false,
      error: "No completed Offscreen response is available in this session.",
    });

    firstSocket.receive({
      type: "tool.call",
      name: "get_calendar_events",
      call_id: "calendar-call",
      arguments: { when: "today" },
    });
    firstSocket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();
    assert.equal(calendarRequestCount, 1);

    firstSocket.receive({ type: "reply.started" });
    firstSocket.receive({ type: "transcript.agent", text: "Response A" });
    firstSocket.receive({ type: "reply.done", status: "completed" });
    repeatLastResponse(firstSocket, "response-a-call");
    await flushPromises();
    assert.deepEqual(findToolResult(firstSocket, "response-a-call"), {
      success: true,
      response: "Response A",
    });

    summarizeLastResponse(firstSocket, "response-a-summary-call");
    await flushPromises();
    assert.deepEqual(findToolResult(firstSocket, "response-a-summary-call"), {
      success: true,
      response: "Response A",
    });
    assert.equal(calendarRequestCount, 1);

    firstSocket.receive({ type: "reply.started" });
    firstSocket.receive({ type: "transcript.agent", text: "Summary B" });
    firstSocket.receive({ type: "reply.done", status: "interrupted" });
    summarizeLastResponse(firstSocket, "interrupted-summary-call");
    await flushPromises();
    assert.deepEqual(findToolResult(firstSocket, "interrupted-summary-call"), {
      success: true,
      response: "Response A",
    });

    firstSocket.receive({ type: "reply.started" });
    firstSocket.receive({ type: "reply.done", status: "interrupted" });
    firstSocket.receive({ type: "transcript.agent", text: "Interrupted B" });
    firstSocket.receive({ type: "reply.started" });
    firstSocket.receive({ type: "reply.done", status: "completed" });
    repeatLastResponse(firstSocket, "interrupted-call");
    await flushPromises();
    assert.deepEqual(findToolResult(firstSocket, "interrupted-call"), {
      success: true,
      response: "Response A",
    });

    firstSocket.receive({ type: "reply.started" });
    firstSocket.receive({ type: "transcript.agent", text: "Response B" });
    firstSocket.receive({ type: "reply.done", status: "completed" });
    firstSocket.receive({ type: "transcript.agent", text: "Stale completed B" });
    firstSocket.receive({ type: "reply.started" });
    firstSocket.receive({ type: "reply.done", status: "completed" });
    repeatLastResponse(firstSocket, "response-b-call");
    await flushPromises();
    assert.deepEqual(findToolResult(firstSocket, "response-b-call"), {
      success: true,
      response: "Response B",
    });

    firstSocket.receive({ type: "reply.started" });
    firstSocket.receive({ type: "reply.done", status: "completed" });
    repeatLastResponse(firstSocket, "tool-only-call");
    await flushPromises();
    assert.deepEqual(findToolResult(firstSocket, "tool-only-call"), {
      success: true,
      response: "Response B",
    });
    assert.equal(calendarRequestCount, 1);

    firstSocket.receive({ type: "reply.started" });
    firstSocket.receive({ type: "transcript.agent", text: "Short Response B" });
    firstSocket.receive({ type: "reply.done", status: "completed" });
    summarizeLastResponse(firstSocket, "completed-summary-call");
    await flushPromises();
    assert.deepEqual(findToolResult(firstSocket, "completed-summary-call"), {
      success: true,
      response: "Short Response B",
    });

    repeatLastResponse(firstSocket, "completed-summary-repeat-call");
    await flushPromises();
    assert.deepEqual(findToolResult(firstSocket, "completed-summary-repeat-call"), {
      success: true,
      response: "Short Response B",
    });

    await elements.get("connect").listeners.click();
    const secondSocket = FakeWebSocket.instances.at(-1);
    secondSocket.open();
    firstSocket.receive({ type: "reply.started" });
    firstSocket.receive({ type: "transcript.agent", text: "Stale response" });
    firstSocket.receive({ type: "reply.done", status: "completed" });
    repeatLastResponse(secondSocket, "reconnect-call");
    await flushPromises();
    assert.deepEqual(findToolResult(secondSocket, "reconnect-call"), {
      success: false,
      error: "No completed Offscreen response is available in this session.",
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    Object.defineProperty(globalThis, "navigator", originalNavigator);
    globalThis.AudioWorkletNode = originalAudioWorkletNode;
  }
});
