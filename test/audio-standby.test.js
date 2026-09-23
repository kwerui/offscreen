import assert from "node:assert/strict";
import test from "node:test";
import {
  pauseMicrophoneCapture,
  prepareMicrophoneCapture,
  playListeningStateCue,
  setUpAudio,
  startMicrophoneCapture,
  tearDownAudio,
} from "../public/audio.js";

function createTrack() {
  return {
    stopCalls: 0,
    stop() {
      this.stopCalls++;
    },
  };
}

test("standby releases the microphone and resume reacquires it before capture restarts", async () => {
  const originalWindow = globalThis.window;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalAudioWorkletNode = globalThis.AudioWorkletNode;
  const tracks = [];
  const sources = [];
  let getUserMediaCalls = 0;

  try {
    globalThis.window = {
      AudioContext: class {
        constructor() {
          this.audioWorklet = { addModule: async () => {} };
          this.currentTime = 0;
          this.state = "running";
        }

        createMediaStreamSource() {
          const source = {
            connectCalls: 0,
            disconnectCalls: 0,
            connect() { this.connectCalls++; },
            disconnect() { this.disconnectCalls++; },
          };
          sources.push(source);
          return source;
        }

        close() {
          this.state = "closed";
          return Promise.resolve();
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
          getUserMedia: async () => {
            getUserMediaCalls++;
            const track = createTrack();
            tracks.push(track);
            return { getTracks: () => [track] };
          },
        },
      },
    });

    assert.equal(
      await setUpAudio({
        isSessionActive: () => true,
        onMicrophoneAudio: () => {},
      }),
      true
    );
    assert.equal(startMicrophoneCapture(), true);
    assert.equal(sources[0].connectCalls, 1);

    pauseMicrophoneCapture();
    assert.equal(tracks[0].stopCalls, 1);
    assert.equal(sources[0].disconnectCalls, 1);

    assert.equal(
      await prepareMicrophoneCapture({ isSessionActive: () => true }),
      true
    );
    assert.equal(getUserMediaCalls, 2);
    assert.equal(startMicrophoneCapture(), true);
    assert.equal(sources[1].connectCalls, 1);
  } finally {
    tearDownAudio();
    globalThis.window = originalWindow;
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete globalThis.navigator;
    globalThis.AudioWorkletNode = originalAudioWorkletNode;
  }
});


test("listening state cues use opposite pitch directions", async () => {
  const originalWindow = globalThis.window;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalAudioWorkletNode = globalThis.AudioWorkletNode;
  const oscillatorFrequencies = [];

  try {
    globalThis.window = {
      AudioContext: class {
        constructor() {
          this.audioWorklet = { addModule: async () => {} };
          this.currentTime = 1;
          this.destination = {};
        }

        createMediaStreamSource() {
          return { connect() {}, disconnect() {} };
        }

        createOscillator() {
          const oscillator = {
            frequency: { value: 0 },
            connect() {},
            start() { oscillatorFrequencies.push(this.frequency.value); },
            stop() {},
          };
          return oscillator;
        }

        createGain() {
          return {
            gain: {
              setValueAtTime() {},
              exponentialRampToValueAtTime() {},
            },
            connect() {},
          };
        }

        close() { return Promise.resolve(); }
      },
    };
    globalThis.AudioWorkletNode = class {
      constructor() { this.port = {}; }
      disconnect() {}
    };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: async () => ({
            getTracks: () => [{ stop() {} }],
          }),
        },
      },
    });

    await setUpAudio({
      isSessionActive: () => true,
      onMicrophoneAudio: () => {},
    });

    assert.equal(playListeningStateCue("paused"), true);
    assert.deepEqual(oscillatorFrequencies.splice(0), [520, 360]);

    assert.equal(playListeningStateCue("listening"), true);
    assert.deepEqual(oscillatorFrequencies.splice(0), [360, 520]);
  } finally {
    tearDownAudio();
    globalThis.window = originalWindow;
    Object.defineProperty(globalThis, "navigator", originalNavigator);
    globalThis.AudioWorkletNode = originalAudioWorkletNode;
  }
});
