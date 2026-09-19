import assert from "node:assert/strict";
import test from "node:test";
import { VOICE_TOOLS } from "../public/tools.js";

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
    "connect", "disconnect", "voice-wake", "resume-listening", "clear", "voice", "prompt",
    "greeting", "transcript", "empty", "status-dot", "status-text",
  ]) {
    elements.set(id, createElement());
  }

  globalThis.document = {
    createElement,
    getElementById: (id) => elements.get(id),
  };
  FakeSpeechRecognition.instances = [];
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
  class FakeAudioWorkletNode {
    static instances = [];

    constructor() {
      this.port = {};
      FakeAudioWorkletNode.instances.push(this);
    }

    emitAudio(bytes = new Uint8Array([1, 2, 3, 4]).buffer) {
      this.port.onmessage?.({ data: bytes });
    }

    disconnect() {}
  }
  globalThis.AudioWorkletNode = FakeAudioWorkletNode;
  const microphoneTracks = [];
  let microphoneRequestCount = 0;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => {
          microphoneRequestCount++;
          const track = {
            stopCalls: 0,
            stop() { this.stopCalls++; },
          };
          microphoneTracks.push(track);
          return { getTracks: () => [track] };
        },
      },
    },
  });
  globalThis.WebSocket = FakeWebSocket;

  return {
    elements,
    microphoneTracks,
    getMicrophoneRequestCount: () => microphoneRequestCount,
  };
}

async function flushPromises() {
  await new Promise((resolve) => setImmediate(resolve));
}

function findToolResult(socket, callId) {
  const message = socket.sentMessages.find(
    (item) => item.type === "tool.result" && item.call_id === callId
  );

  return message && JSON.parse(message.result);
}

function latestSessionUpdate(socket) {
  return socket.sentMessages.filter(
    (message) => message.type === "session.update"
  ).at(-1);
}

test("keeps standby client-controlled while unrelated speech and Codex work continue", async () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalAudioWorkletNode = globalThis.AudioWorkletNode;
  const originalCapabilities = globalThis.__OFFSCREEN_CAPABILITIES__;
  const codexResponse = createDeferred();
  let codexFetchCalls = 0;

  try {
    const {
      elements,
      microphoneTracks,
      getMicrophoneRequestCount,
    } = setUpBrowserEnvironment();
    globalThis.fetch = async (url) => {
      if (url === "/api/voice-token") {
        return { ok: true, json: async () => ({ token: "test-token" }) };
      }

      codexFetchCalls++;
      return codexResponse.promise;
    };
    globalThis.__OFFSCREEN_CAPABILITIES__ = {
      isHostedDemo: false,
      calendar: true,
      codex: true,
      developerWorkspace: true,
      browserControl: true,
    };

    await import(`../public/app.js?standby-test=${Date.now()}`);
    assert.equal(elements.get("prompt").disabled, false);
    await elements.get("connect").listeners.click();
    const firstSocket = FakeWebSocket.instances.at(-1);
    firstSocket.open();
    firstSocket.receive({ type: "session.ready", session_id: "first" });
    assert.equal(elements.get("resume-listening").textContent, "Pause Listening");

    const captureNode = globalThis.AudioWorkletNode.instances.at(-1);
    captureNode.emitAudio();
    assert.equal(
      firstSocket.sentMessages.filter((message) => message.type === "input.audio").length,
      1
    );

    elements.get("resume-listening").listeners.click();
    captureNode.emitAudio();
    assert.equal(
      firstSocket.sentMessages.filter((message) => message.type === "input.audio").length,
      1,
      "standby must block PCM at the final WebSocket send boundary"
    );
    assert.equal(elements.get("resume-listening").textContent, "Resume Listening");
    assert.match(latestSessionUpdate(firstSocket).session.system_prompt, /You are in standby/);
    assert.equal(microphoneTracks[0].stopCalls, 1);
    assert.equal(FakeSpeechRecognition.instances.length, 1);
    assert.equal(FakeSpeechRecognition.instances[0].startCalls, 1);

    elements.get("resume-listening").listeners.click();
    await flushPromises();
    assert.equal(elements.get("resume-listening").textContent, "Pause Listening");
    assert.doesNotMatch(latestSessionUpdate(firstSocket).session.system_prompt, /You are in standby/);
    assert.equal(getMicrophoneRequestCount(), 2);
    assert.equal(FakeSpeechRecognition.instances[0].stopCalls, 1);

    firstSocket.receive({
      type: "tool.call",
      name: "ask_codex",
      call_id: "codex-call",
      arguments: { task: "Inspect this project." },
    });
    await flushPromises();
    firstSocket.receive({
      type: "tool.call",
      name: "pause_listening",
      call_id: "pause-call",
      arguments: {},
    });

    assert.equal(
      elements.get("status-text").textContent,
      "Pausing listening…",
      "voice pause must defer local standby-listener ownership until reply.done"
    );

    firstSocket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    assert.equal(
      elements.get("status-text").textContent,
      'Standby — say “Resume listening” or “Disconnect”; other speech is not sent to the Voice Agent.',
      "the local standby listener should take ownership after reply.done"
    );

    assert.equal(elements.get("resume-listening").disabled, false);
    assert.equal(elements.get("resume-listening").textContent, "Resume Listening");
    assert.equal(
      elements.get("status-text").textContent,
      'Standby — say “Resume listening” or “Disconnect”; other speech is not sent to the Voice Agent.'
    );
    assert.match(latestSessionUpdate(firstSocket).session.system_prompt, /You are in standby/);
    assert.deepEqual(latestSessionUpdate(firstSocket).session.tools, []);

    // The model may try to speak an acknowledgement after the pause tool
    // result. Keep it suppressed so the local standby recognizer cannot hear
    // Offscreen's own speaker output and accidentally resume the session.
    const bubbleCountBeforePauseAck = elements.get("transcript").children.length;
    firstSocket.receive({ type: "reply.started" });
    firstSocket.receive({ type: "reply.audio", data: "AQAA" });
    firstSocket.receive({ type: "transcript.agent", text: "OK. I'm on standby." });
    firstSocket.receive({ type: "reply.done", status: "completed" });
    assert.equal(elements.get("transcript").children.length, bubbleCountBeforePauseAck);
    assert.equal(elements.get("resume-listening").textContent, "Resume Listening");

    const sessionUpdateCount = firstSocket.sentMessages.filter(
      (message) => message.type === "session.update"
    ).length;
    const transcriptBubbleCount = elements.get("transcript").children.length;
    firstSocket.receive({ type: "transcript.user", text: "ten plus ten" });
    firstSocket.receive({ type: "reply.started" });
    firstSocket.receive({ type: "reply.audio", data: "AQAA" });
    firstSocket.receive({ type: "transcript.agent", text: "Ten plus ten is twenty." });
    firstSocket.receive({
      type: "tool.call",
      name: "ask_codex",
      call_id: "standby-codex-call",
      arguments: { task: "This must not run." },
    });
    firstSocket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    // A rejected tool result can cause the Voice Agent to generate another
    // reply. Standby suppression must remain active across that follow-up too.
    firstSocket.receive({ type: "reply.started" });
    firstSocket.receive({ type: "reply.audio", data: "AQAA" });
    firstSocket.receive({ type: "transcript.agent", text: "I cannot run that." });
    firstSocket.receive({ type: "reply.done", status: "completed" });

    assert.equal(elements.get("resume-listening").disabled, false);
    assert.equal(
      elements.get("status-text").textContent,
      'Standby — say “Resume listening” or “Disconnect”; other speech is not sent to the Voice Agent.'
    );
    assert.equal(
      firstSocket.sentMessages.filter((message) => message.type === "session.update").length,
      sessionUpdateCount
    );
    assert.equal(elements.get("transcript").children.length, transcriptBubbleCount + 1);
    const ignoredBubble = elements.get("transcript").children.at(-1);
    assert.equal(ignoredBubble.children.at(-1)?.className, "meta");
    assert.equal(ignoredBubble.children.at(-1)?.textContent, "ignored in standby");
    assert.equal(codexFetchCalls, 1);

    for (const ignoredText of ["okay", "continue"]) {
      firstSocket.receive({ type: "transcript.user", text: ignoredText });
      firstSocket.receive({ type: "reply.done", status: "completed" });
    }
    assert.equal(elements.get("resume-listening").disabled, false);

    codexResponse.resolve({ ok: true, json: async () => ({ output: "Complete." }) });
    await flushPromises();
    assert.deepEqual(findToolResult(firstSocket, "pause-call"), { success: true, standby: true });
    assert.deepEqual(findToolResult(firstSocket, "codex-call"), { success: true, output: "Complete." });
    assert.deepEqual(findToolResult(firstSocket, "standby-codex-call"), {
      success: false,
      error: "Tool calls are unavailable while Offscreen is in standby.",
    });

    const standbyRecognition = FakeSpeechRecognition.instances.at(-1);
    const bubbleCountBeforeLocalResume = elements.get("transcript").children.length;
    standbyRecognition.receiveTranscript("Resume listening!");
    await flushPromises();
    assert.equal(elements.get("transcript").children.length, bubbleCountBeforeLocalResume);
    assert.equal(elements.get("resume-listening").disabled, false);
    assert.equal(elements.get("resume-listening").textContent, "Pause Listening");
    assert.equal(elements.get("status-text").textContent, "Connected");
    assert.deepEqual(latestSessionUpdate(firstSocket).session.tools, VOICE_TOOLS);
    assert.doesNotMatch(latestSessionUpdate(firstSocket).session.system_prompt, /You are in standby/);

    firstSocket.receive({ type: "transcript.user", text: "what time is it" });
    const normalRequestBubble = elements.get("transcript").children.at(-1);
    assert.equal(
      normalRequestBubble.children.some((child) => child.textContent === "ignored in standby"),
      false
    );

    // Leaving standby clears reply suppression so normal agent output is shown.
    const bubbleCountAfterResume = elements.get("transcript").children.length;
    firstSocket.receive({ type: "reply.started" });
    firstSocket.receive({ type: "transcript.agent", text: "Listening again." });
    firstSocket.receive({ type: "reply.done", status: "completed" });
    assert.equal(elements.get("transcript").children.length, bubbleCountAfterResume + 1);

    // Any stale AssemblyAI transcript received after pausing is ignored and
    // cannot resume the session. Only the local standby recognizer owns resume.
    firstSocket.receive({
      type: "tool.call",
      name: "pause_listening",
      call_id: "pause-for-local-resume-call",
      arguments: {},
    });
    firstSocket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();
    const localResumeRecognition = FakeSpeechRecognition.instances.at(-1);
    const bubbleCountBeforeStaleResume = elements.get("transcript").children.length;
    firstSocket.receive({ type: "transcript.user", text: "resume listening" });
    assert.equal(elements.get("resume-listening").textContent, "Resume Listening");
    assert.equal(elements.get("transcript").children.length, bubbleCountBeforeStaleResume + 1);
    assert.equal(
      elements.get("transcript").children.at(-1).children.at(-1)?.textContent,
      "ignored in standby"
    );
    localResumeRecognition.receiveTranscript("resume listening");
    await flushPromises();
    assert.equal(elements.get("resume-listening").textContent, "Pause Listening");
    assert.equal(elements.get("status-text").textContent, "Connected");

    firstSocket.receive({
      type: "tool.call",
      name: "pause_listening",
      call_id: "pause-for-ui-call",
      arguments: {},
    });
    firstSocket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();
    elements.get("resume-listening").listeners.click();
    await flushPromises();
    assert.equal(elements.get("resume-listening").disabled, false);
    assert.equal(elements.get("resume-listening").textContent, "Pause Listening");
    assert.equal(elements.get("status-text").textContent, "Connected");

    firstSocket.receive({
      type: "tool.call",
      name: "pause_listening",
      call_id: "pause-for-disconnect-call",
      arguments: {},
    });
    firstSocket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();
    const disconnectRecognition = FakeSpeechRecognition.instances.at(-1);
    disconnectRecognition.receiveTranscript("disconnect");
    assert.equal(firstSocket.readyState, FakeWebSocket.CLOSED);

    await elements.get("connect").listeners.click();
    const secondSocket = FakeWebSocket.instances.at(-1);
    secondSocket.open();
    secondSocket.receive({ type: "session.ready", session_id: "second" });
    secondSocket.receive({
      type: "tool.call",
      name: "pause_listening",
      call_id: "second-pause-call",
      arguments: {},
    });
    secondSocket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();
    firstSocket.receive({ type: "transcript.user", text: "resume listening" });

    assert.equal(elements.get("resume-listening").disabled, false);
    assert.match(latestSessionUpdate(secondSocket).session.system_prompt, /You are in standby/);
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
