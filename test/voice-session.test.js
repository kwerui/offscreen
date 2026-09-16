import assert from "node:assert/strict";
import test from "node:test";
import { createVoiceSession } from "../public/voice-session.js";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sentMessages = [];
    this.closeCount = 0;
    FakeWebSocket.instances.push(this);
  }

  send(message) {
    this.sentMessages.push(message);
  }

  close() {
    this.closeCount++;
    this.readyState = FakeWebSocket.CLOSED;
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(event) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}

function createSession(fetchImpl) {
  FakeWebSocket.instances = [];

  return createVoiceSession({
    fetchImpl,
    WebSocketImpl: FakeWebSocket,
  });
}

function successfulTokenFetch(token = "temporary token") {
  return async () => ({
    ok: true,
    json: async () => ({ token }),
  });
}

test("requests a temporary token and creates the AssemblyAI WebSocket URL", async () => {
  let requestedUrl;
  const voiceSession = createSession(async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      json: async () => ({ token: "token with spaces" }),
    };
  });

  await voiceSession.connect({});

  assert.equal(requestedUrl, "/api/voice-token");
  assert.equal(
    FakeWebSocket.instances[0].url,
    "wss://agents.assemblyai.com/v1/ws?token=token%20with%20spaces"
  );
});

test("runs connection preparation after token fetching and before socket creation", async () => {
  const connectionSteps = [];
  const voiceSession = createSession(async () => {
    connectionSteps.push("token");
    return {
      ok: true,
      json: async () => ({ token: "temporary token" }),
    };
  });

  await voiceSession.connect({
    prepareConnection: async () => {
      connectionSteps.push("prepare");
      assert.equal(FakeWebSocket.instances.length, 0);
    },
  });

  assert.deepEqual(connectionSteps, ["token", "prepare"]);
  assert.equal(FakeWebSocket.instances.length, 1);
});

test("passes parsed incoming AssemblyAI events to the connection callback", async () => {
  const receivedEvents = [];
  const voiceSession = createSession(successfulTokenFetch());

  await voiceSession.connect({
    onEvent: (event) => receivedEvents.push(event),
  });

  FakeWebSocket.instances[0].receive({ type: "session.ready", session_id: "abc" });

  assert.deepEqual(receivedEvents, [{ type: "session.ready", session_id: "abc" }]);
});

test("serializes outgoing messages only after the current socket opens", async () => {
  const voiceSession = createSession(successfulTokenFetch());

  await voiceSession.connect({});
  assert.equal(voiceSession.send({ type: "input.audio", audio: "pcm" }), false);

  FakeWebSocket.instances[0].open();

  assert.equal(voiceSession.send({ type: "input.audio", audio: "pcm" }), true);
  assert.deepEqual(FakeWebSocket.instances[0].sentMessages, [
    JSON.stringify({ type: "input.audio", audio: "pcm" }),
  ]);
});

test("disconnect closes the current socket and prevents later sends", async () => {
  const voiceSession = createSession(successfulTokenFetch());

  await voiceSession.connect({});
  const socket = FakeWebSocket.instances[0];
  socket.open();

  voiceSession.disconnect();

  assert.equal(socket.closeCount, 1);
  assert.equal(voiceSession.isOpen(), false);
  assert.equal(voiceSession.send({ type: "input.audio", audio: "pcm" }), false);
});

test("replaces an existing socket before opening a new connection", async () => {
  const voiceSession = createSession(successfulTokenFetch());

  await voiceSession.connect({});
  const firstSocket = FakeWebSocket.instances[0];

  await voiceSession.connect({});

  assert.equal(firstSocket.closeCount, 1);
  assert.equal(FakeWebSocket.instances.length, 2);
});

test("does not create a stale socket when an earlier token request resolves late", async () => {
  const tokenRequests = [];
  const voiceSession = createSession(() => new Promise((resolve) => {
    tokenRequests.push(resolve);
  }));

  const firstConnect = voiceSession.connect({});
  const secondConnect = voiceSession.connect({});

  tokenRequests[1]({
    ok: true,
    json: async () => ({ token: "second-token" }),
  });
  await secondConnect;

  tokenRequests[0]({
    ok: true,
    json: async () => ({ token: "first-token" }),
  });
  await firstConnect;

  assert.equal(FakeWebSocket.instances.length, 1);
  assert.equal(
    FakeWebSocket.instances[0].url,
    "wss://agents.assemblyai.com/v1/ws?token=second-token"
  );
});

test("does not create a stale socket when preparation finishes late", async () => {
  let resolvePreparation;
  let signalPreparationStarted;
  const preparationStarted = new Promise((resolve) => {
    signalPreparationStarted = resolve;
  });
  const voiceSession = createSession(successfulTokenFetch());

  const firstConnect = voiceSession.connect({
    prepareConnection: () => {
      signalPreparationStarted();
      return new Promise((resolve) => {
        resolvePreparation = resolve;
      });
    },
  });
  await preparationStarted;

  await voiceSession.connect({});
  resolvePreparation(true);
  await firstConnect;

  assert.equal(FakeWebSocket.instances.length, 1);
});

test("ignores late events from a replaced socket", async () => {
  const firstCallbacks = [];
  const secondCallbacks = [];
  const voiceSession = createSession(successfulTokenFetch());

  await voiceSession.connect({
    onOpen: () => firstCallbacks.push("open"),
    onEvent: () => firstCallbacks.push("message"),
    onError: () => firstCallbacks.push("error"),
    onClose: () => firstCallbacks.push("close"),
  });
  const firstSocket = FakeWebSocket.instances[0];

  await voiceSession.connect({
    onOpen: () => secondCallbacks.push("open"),
  });
  const secondSocket = FakeWebSocket.instances[1];
  secondSocket.open();

  firstSocket.open();
  firstSocket.receive({ type: "session.ready" });
  firstSocket.onerror?.({ type: "error" });
  firstSocket.onclose?.({ code: 1000 });

  assert.deepEqual(firstCallbacks, []);
  assert.deepEqual(secondCallbacks, ["open"]);
  assert.equal(voiceSession.isOpen(), true);
});

test("rejects token failures so the application can use its existing error path", async () => {
  const voiceSession = createSession(async () => ({
    ok: false,
    status: 503,
  }));

  await assert.rejects(
    voiceSession.connect({}),
    (error) => error.stage === "token" && error.message === "Failed to fetch token: 503"
  );
});
