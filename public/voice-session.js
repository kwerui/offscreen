const VOICE_AGENT_WS_URL = "wss://agents.assemblyai.com/v1/ws";

export function createVoiceSession({
  fetchImpl = globalThis.fetch,
  WebSocketImpl = globalThis.WebSocket,
} = {}) {
  let connectionAttempt = 0;
  let isConnecting = false;
  let socket = null;

  async function connect(callbacks = {}) {
    disconnect();

    const attempt = connectionAttempt;
    isConnecting = true;

    let token;

    try {
      token = await fetchVoiceToken(fetchImpl);
    } catch (error) {
      if (attempt === connectionAttempt) {
        isConnecting = false;
      }

      throw error;
    }

    if (attempt !== connectionAttempt) {
      return false;
    }

    const isPrepared = await callbacks.prepareConnection?.();

    if (isPrepared === false) {
      if (attempt === connectionAttempt) {
        isConnecting = false;
      }

      return false;
    }

    if (attempt !== connectionAttempt) {
      return false;
    }

    let connectionSocket;

    try {
      connectionSocket = new WebSocketImpl(
        `${VOICE_AGENT_WS_URL}?token=${encodeURIComponent(token)}`
      );
    } catch (error) {
      isConnecting = false;
      throw error;
    }

    if (attempt !== connectionAttempt) {
      closeSocket(connectionSocket);
      return false;
    }

    socket = connectionSocket;
    connectionSocket.binaryType = "arraybuffer";

    connectionSocket.onopen = () => {
      if (socket !== connectionSocket) {
        closeSocket(connectionSocket);
        return;
      }

      isConnecting = false;
      callbacks.onOpen?.();
    };

    connectionSocket.onmessage = (event) => {
      if (socket !== connectionSocket) {
        return;
      }

      callbacks.onEvent?.(JSON.parse(event.data));
    };

    connectionSocket.onerror = (event) => {
      if (socket !== connectionSocket) {
        return;
      }

      callbacks.onError?.(event);
    };

    connectionSocket.onclose = (event) => {
      if (socket !== connectionSocket) {
        return;
      }

      socket = null;
      isConnecting = false;
      callbacks.onClose?.(event);
    };

    return true;
  }

  function disconnect() {
    connectionAttempt++;
    isConnecting = false;

    const currentSocket = socket;
    socket = null;

    closeSocket(currentSocket);
  }

  function send(message) {
    if (!isOpen()) {
      return false;
    }

    socket.send(JSON.stringify(message));
    return true;
  }

  function isOpen() {
    return socket?.readyState === WebSocketImpl.OPEN;
  }

  function hasConnection() {
    return isConnecting || socket !== null;
  }

  return {
    connect,
    disconnect,
    hasConnection,
    isOpen,
    send,
  };
}

async function fetchVoiceToken(fetchImpl) {
  try {
    const response = await fetchImpl("/api/voice-token");

    if (!response.ok) {
      throw new Error(`Failed to fetch token: ${response.status}`);
    }

    const { token } = await response.json();
    return token;
  } catch (error) {
    error.stage = "token";
    throw error;
  }
}

function closeSocket(socket) {
  if (
    !socket ||
    socket.readyState === socket.constructor.CLOSING ||
    socket.readyState === socket.constructor.CLOSED
  ) {
    return;
  }

  try {
    socket.close();
  } catch (error) {
    console.error("WebSocket close error:", error);
  }
}
