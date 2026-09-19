const SAMPLE_RATE = 24_000;

let audioCtx = null;
let micStream = null;
let workletNode = null;
let micSource = null;
let microphoneCaptureActive = false;
let playbackTime = 0;
let scheduledSources = [];

const MICROPHONE_CONSTRAINTS = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
};

export function hasAudioResources() {
  return Boolean(audioCtx || micStream || workletNode || micSource);
}

export async function setUpAudio({
  isSessionActive,
  onMicrophoneAudio,
}) {
  let connectionAudioContext;
  let capturedMicrophoneStream;
  let microphoneSource;
  let processorNode;

  try {
    connectionAudioContext = new (
      window.AudioContext || window.webkitAudioContext
    )({
      sampleRate: SAMPLE_RATE,
    });
  } catch (err) {
    throw createAudioError("context", err);
  }

  if (!isSessionActive()) {
    closeAudioContext(connectionAudioContext);
    return false;
  }

  try {
    capturedMicrophoneStream = await navigator.mediaDevices.getUserMedia(
      MICROPHONE_CONSTRAINTS
    );
  } catch (err) {
    closeAudioContext(connectionAudioContext);
    throw createAudioError("microphone", err);
  }

  if (!isSessionActive()) {
    stopMicrophoneTracks(capturedMicrophoneStream);
    closeAudioContext(connectionAudioContext);
    return false;
  }

  try {
    await connectionAudioContext.audioWorklet.addModule("pcm-processor.js");
  } catch (err) {
    stopMicrophoneTracks(capturedMicrophoneStream);
    closeAudioContext(connectionAudioContext);
    throw createAudioError("worklet", err);
  }

  if (!isSessionActive()) {
    stopMicrophoneTracks(capturedMicrophoneStream);
    closeAudioContext(connectionAudioContext);
    return false;
  }

  try {
    microphoneSource = connectionAudioContext.createMediaStreamSource(
      capturedMicrophoneStream
    );
    processorNode = new AudioWorkletNode(
      connectionAudioContext,
      "pcm-processor"
    );
  } catch (err) {
    disconnectAudioNode(processorNode);
    disconnectAudioNode(microphoneSource);
    stopMicrophoneTracks(capturedMicrophoneStream);
    closeAudioContext(connectionAudioContext);
    throw createAudioError("nodes", err);
  }

  if (!isSessionActive()) {
    disconnectAudioNode(processorNode);
    disconnectAudioNode(microphoneSource);
    stopMicrophoneTracks(capturedMicrophoneStream);
    closeAudioContext(connectionAudioContext);
    return false;
  }

  processorNode.port.onmessage = (event) => {
    if (isSessionActive() && microphoneCaptureActive) {
      onMicrophoneAudio(arrayBufferToBase64(event.data));
    }
  };

  audioCtx = connectionAudioContext;
  micStream = capturedMicrophoneStream;
  micSource = microphoneSource;
  workletNode = processorNode;
  microphoneCaptureActive = false;
  playbackTime = connectionAudioContext.currentTime;
  scheduledSources = [];

  return true;
}

export function startMicrophoneCapture() {
  if (!micSource || !workletNode || microphoneCaptureActive) {
    return false;
  }

  micSource.connect(workletNode);
  microphoneCaptureActive = true;
  return true;
}

export function pauseMicrophoneCapture() {
  microphoneCaptureActive = false;
  disconnectAudioNode(micSource);
  stopMicrophoneTracks(micStream);
  micStream = null;
  micSource = null;
}

export async function prepareMicrophoneCapture({ isSessionActive }) {
  if (!audioCtx || !workletNode) {
    return false;
  }

  if (micSource && micStream) {
    return true;
  }

  let capturedMicrophoneStream;
  let microphoneSource;

  try {
    capturedMicrophoneStream = await navigator.mediaDevices.getUserMedia(
      MICROPHONE_CONSTRAINTS
    );
  } catch (err) {
    throw createAudioError("microphone", err);
  }

  if (!isSessionActive()) {
    stopMicrophoneTracks(capturedMicrophoneStream);
    return false;
  }

  try {
    microphoneSource = audioCtx.createMediaStreamSource(
      capturedMicrophoneStream
    );
  } catch (err) {
    stopMicrophoneTracks(capturedMicrophoneStream);
    throw createAudioError("nodes", err);
  }

  if (!isSessionActive()) {
    disconnectAudioNode(microphoneSource);
    stopMicrophoneTracks(capturedMicrophoneStream);
    return false;
  }

  micStream = capturedMicrophoneStream;
  micSource = microphoneSource;
  microphoneCaptureActive = false;
  return true;
}

export function playPCM(base64Audio, isSessionActive) {
  if (!audioCtx) {
    return;
  }

  const bytes = Uint8Array.from(atob(base64Audio), (char) =>
    char.charCodeAt(0)
  );
  const int16 = new Int16Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength / 2
  );
  const float32 = new Float32Array(int16.length);

  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 0x8000;
  }

  const buffer = audioCtx.createBuffer(1, float32.length, SAMPLE_RATE);
  buffer.getChannelData(0).set(float32);

  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(audioCtx.destination);

  const now = audioCtx.currentTime;
  if (playbackTime < now) {
    playbackTime = now;
  }

  source.start(playbackTime);
  playbackTime += buffer.duration;
  scheduledSources.push(source);

  source.onended = () => {
    if (isSessionActive()) {
      scheduledSources = scheduledSources.filter((item) => item !== source);
    }
  };
}


export function playListeningStateCue(state) {
  if (!audioCtx || typeof audioCtx.createOscillator !== "function") {
    return false;
  }

  const frequencies = state === "paused" ? [520, 360] : [360, 520];
  const now = audioCtx.currentTime;

  frequencies.forEach((frequency, index) => {
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain?.();
    const startAt = now + index * 0.09;
    const stopAt = startAt + 0.07;

    oscillator.frequency.value = frequency;

    if (gain) {
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.08, startAt + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
      oscillator.connect(gain);
      gain.connect(audioCtx.destination);
    } else {
      oscillator.connect(audioCtx.destination);
    }

    oscillator.start(startAt);
    oscillator.stop(stopAt);
  });

  return true;
}

export function flushPlayback() {
  for (const source of scheduledSources) {
    try {
      source.stop();
    } catch (_) {}
  }

  scheduledSources = [];

  if (audioCtx) {
    playbackTime = audioCtx.currentTime;
  }
}

export function tearDownAudio() {
  const audioContext = audioCtx;
  const microphoneStream = micStream;
  const processor = workletNode;
  const microphoneSource = micSource;

  flushPlayback();

  audioCtx = null;
  micStream = null;
  workletNode = null;
  micSource = null;
  microphoneCaptureActive = false;

  disconnectAudioNode(processor);
  disconnectAudioNode(microphoneSource);
  stopMicrophoneTracks(microphoneStream);
  closeAudioContext(audioContext);
}

function createAudioError(stage, cause) {
  const error = new Error(`Audio ${stage} error`);
  error.stage = stage;
  error.cause = cause;
  return error;
}

function disconnectAudioNode(audioNode) {
  if (!audioNode) {
    return;
  }

  try {
    audioNode.disconnect();
  } catch (err) {
    console.error("Audio node disconnect error:", err);
  }
}

function stopMicrophoneTracks(stream) {
  if (!stream) {
    return;
  }

  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch (err) {
      console.error("Microphone track stop error:", err);
    }
  }
}

function closeAudioContext(audioContext) {
  if (!audioContext || audioContext.state === "closed") {
    return;
  }

  audioContext.close().catch((err) => {
    console.error("Audio context close error:", err);
  });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;

  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk)
    );
  }

  return btoa(binary);
}
