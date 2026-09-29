import assert from "node:assert/strict";
import test from "node:test";
import { createPhraseListener, createWakeListener } from "../public/wake-listener.js";

class FakeSpeechRecognition {
  static instances = [];

  constructor() {
    this.continuous = false;
    this.interimResults = true;
    this.lang = "";
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

  receiveTranscript(text, isFinal = true) {
    const result = [{ transcript: text }];
    result.isFinal = isFinal;
    this.onresult?.({ resultIndex: 0, results: [result] });
  }

  end() {
    this.onend?.();
  }

  fail(error) {
    this.onerror?.({ error });
  }
}

async function flushMicrotasks() {
  await Promise.resolve();
}

test("matches only the configured wake phrase and stops before waking", () => {
  const originalWindow = globalThis.window;
  let wakeCalls = 0;

  try {
    FakeSpeechRecognition.instances = [];
    globalThis.window = { SpeechRecognition: FakeSpeechRecognition };

    const wakeListener = createWakeListener({
      phrase: "connect offscreen",
      onWake: () => { wakeCalls++; },
    });

    assert.equal(wakeListener.isSupported(), true);
    assert.equal(wakeListener.start(), true);

    const recognition = FakeSpeechRecognition.instances.at(-1);
    assert.equal(recognition.continuous, true);
    assert.equal(recognition.interimResults, false);
    assert.equal(recognition.lang, "en-US");
    assert.equal(recognition.startCalls, 1);

    recognition.receiveTranscript("connect");
    recognition.receiveTranscript("connect offscreen please");
    assert.equal(wakeCalls, 0);
    assert.equal(recognition.stopCalls, 0);

    recognition.receiveTranscript('“Connect off-screen!”');
    assert.equal(wakeCalls, 1);
    assert.equal(recognition.stopCalls, 1);
    assert.equal(wakeListener.isActive(), false);

    recognition.receiveTranscript("Connect Offscreen");
    assert.equal(wakeCalls, 1);
  } finally {
    globalThis.window = originalWindow;
  }
});


test("matches one of several bounded local phrases", () => {
  const originalWindow = globalThis.window;
  const matched = [];

  try {
    FakeSpeechRecognition.instances = [];
    globalThis.window = { SpeechRecognition: FakeSpeechRecognition };

    const listener = createPhraseListener({
      phrases: ["resume listening", "disconnect", "hang up"],
      onPhrase: (phrase) => matched.push(phrase),
    });

    assert.equal(listener.start(), true);
    const recognition = FakeSpeechRecognition.instances.at(-1);

    recognition.receiveTranscript("keep working");
    assert.deepEqual(matched, []);

    recognition.receiveTranscript("Resume listening!");
    assert.deepEqual(matched, ["resume listening"]);
    assert.equal(recognition.stopCalls, 1);
    assert.equal(listener.isActive(), false);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("restarts after an unexpected end but not after an explicit stop", async () => {
  const originalWindow = globalThis.window;

  try {
    FakeSpeechRecognition.instances = [];
    globalThis.window = { webkitSpeechRecognition: FakeSpeechRecognition };

    const wakeListener = createWakeListener({
      phrase: "connect offscreen",
      onWake: () => {},
    });

    wakeListener.start();
    const recognition = FakeSpeechRecognition.instances.at(-1);
    recognition.end();
    await flushMicrotasks();
    assert.equal(recognition.startCalls, 2);

    wakeListener.stop();
    recognition.end();
    await flushMicrotasks();
    assert.equal(recognition.startCalls, 2);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("disables itself after a fatal recognition error", () => {
  const originalWindow = globalThis.window;
  const errors = [];

  try {
    FakeSpeechRecognition.instances = [];
    globalThis.window = { SpeechRecognition: FakeSpeechRecognition };

    const wakeListener = createWakeListener({
      phrase: "connect offscreen",
      onWake: () => {},
      onError: (error) => errors.push(error),
    });

    wakeListener.start();
    const recognition = FakeSpeechRecognition.instances.at(-1);
    recognition.fail("not-allowed");

    assert.deepEqual(errors, ["not-allowed"]);
    assert.equal(wakeListener.isActive(), false);
  } finally {
    globalThis.window = originalWindow;
  }
});

test("reports unsupported browsers without creating a recognizer", () => {
  const originalWindow = globalThis.window;

  try {
    globalThis.window = {};

    const wakeListener = createWakeListener({
      phrase: "connect offscreen",
      onWake: () => {},
    });

    assert.equal(wakeListener.isSupported(), false);
    assert.equal(wakeListener.start(), false);
    assert.equal(wakeListener.isActive(), false);
  } finally {
    globalThis.window = originalWindow;
  }
});
