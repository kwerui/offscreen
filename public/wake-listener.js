function normalizeWakePhrase(text) {
  return text
    ?.trim()
    .toLowerCase()
    .replace(/[.,!?;:]+$/, "")
    .replace(/\boff[\s-]+screen\b/g, "offscreen")
    .replace(/\s+/g, " ");
}

export function createWakeListener({
  phrase,
  onWake,
  onError = () => {},
}) {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    return {
      isSupported: () => false,
      start: () => false,
      stop: () => {},
      isActive: () => false,
    };
  }

  const normalizedPhrase = normalizeWakePhrase(phrase);
  let recognition = null;
  let shouldListen = false;
  let isRunning = false;
  let restartQueued = false;

  function ensureRecognition() {
    if (recognition) {
      return recognition;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      if (!shouldListen) {
        return;
      }

      const startIndex = event.resultIndex ?? 0;

      for (let index = startIndex; index < event.results.length; index++) {
        const result = event.results[index];

        if (result.isFinal === false) {
          continue;
        }

        const transcript = result[0]?.transcript;

        if (normalizeWakePhrase(transcript) !== normalizedPhrase) {
          continue;
        }

        shouldListen = false;

        try {
          recognition.stop();
        } catch {
          // The recognizer may already be ending. The wake action can still run.
        }

        onWake();
        return;
      }
    };

    recognition.onerror = (event) => {
      const error = event.error || "unknown";
      const isFatal = error !== "aborted" && error !== "no-speech";

      if (isFatal) {
        shouldListen = false;
      }

      if (isFatal) {
        onError(error);
      }
    };

    recognition.onend = () => {
      isRunning = false;

      if (!shouldListen || restartQueued) {
        return;
      }

      restartQueued = true;
      queueMicrotask(() => {
        restartQueued = false;

        if (shouldListen) {
          startRecognition();
        }
      });
    };

    return recognition;
  }

  function startRecognition() {
    if (!shouldListen || isRunning) {
      return true;
    }

    const activeRecognition = ensureRecognition();

    try {
      isRunning = true;
      activeRecognition.start();
      return true;
    } catch (error) {
      isRunning = false;
      shouldListen = false;
      onError(error?.name || "start-failed");
      return false;
    }
  }

  function start() {
    shouldListen = true;
    return startRecognition();
  }

  function stop() {
    const wasListening = shouldListen;
    shouldListen = false;

    if (!wasListening || !recognition || !isRunning) {
      return;
    }

    try {
      recognition.stop();
    } catch {
      isRunning = false;
    }
  }

  return {
    isSupported: () => true,
    start,
    stop,
    isActive: () => shouldListen,
  };
}
