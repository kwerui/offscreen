import {
  addBubble,
  bindControls,
  clearToolStatus,
  finalizeUserTranscript,
  getVoiceAgentSettings,
  resetUserPartialTranscript,
  setConnectButtonDisabled,
  setDisconnectButtonDisabled,
  setStatus,
  showToolStatus,
  updateUserPartialTranscript,
} from "./ui.js";
import {
  flushPlayback,
  hasAudioResources,
  playPCM,
  setUpAudio,
  startMicrophoneCapture,
  tearDownAudio,
} from "./audio.js";
import { VOICE_TOOLS } from "./tools.js";
import { openWebsite } from "./website-tool.js";
import { getCalendarEvents } from "./calendar-tool.js";
import { runCodexTask } from "./codex-tool.js";
import { createCodexCallTracker } from "./codex-call-tracker.js";
import { createToolResultCoordinator } from "./tool-result-coordinator.js";

      const WS_URL =
        "wss://agents.assemblyai.com/v1/ws";

      let ws = null;
      let activeSessionId = 0;

      let activeToolTurnId = 0;

      function isActiveSession(sessionId) {
        return sessionId === activeSessionId;
      }

      function isActiveToolTurn(sessionId, toolTurnId) {
        return (
          isActiveSession(sessionId) &&
          toolTurnId === activeToolTurnId
        );
      }

      const codexCallTracker = createCodexCallTracker({
        sendCancellationResult: (sessionId, toolTurnId, callId, result) => {
          const wasSent = sendToolResult(
            sessionId,
            toolTurnId,
            callId,
            result
          );

          if (wasSent) {
            console.log("Superseded Codex tool cancelled");
          }

          return wasSent;
        },
      });

      const toolResultCoordinator = createToolResultCoordinator({
        isCurrent: isActiveToolTurn,
        canSendResults: (sessionId, toolTurnId) => (
          isActiveToolTurn(sessionId, toolTurnId) &&
          ws &&
          ws.readyState === WebSocket.OPEN
        ),
        sendToolResult: (sessionId, toolTurnId, callId, result) => {
          const wasSent = sendToolResult(
            sessionId,
            toolTurnId,
            callId,
            result
          );

          if (wasSent) {
            codexCallTracker.resolveCall(callId);
          }

          return wasSent;
        },
        onFlush: (resultCount) => {
          console.log(`Sending ${resultCount} tool result(s)`);
        },
      });

      function invalidateToolTurn() {
        activeToolTurnId++;
        toolResultCoordinator.reset();
        clearToolStatus();
      }

      function endActiveSession(statusState = "", statusText = "Disconnected") {
        activeSessionId++;
        teardown(statusState, statusText);
      }

      async function fetchToken() {
        const response =
          await fetch("/api/voice-token");

        if (!response.ok) {
          throw new Error(
            "Failed to fetch token: " +
              response.status
          );
        }

        const { token } =
          await response.json();

        return token;
      }

      async function connect() {
        const sessionId = activeSessionId + 1;

        if (ws || hasAudioResources()) {
          activeSessionId = sessionId;
          teardown();
        } else {
          activeSessionId = sessionId;
        }

        setConnectButtonDisabled(true);

        setStatus(
          "connecting",
          "Requesting token…"
        );

        let token;

        let connectionSocket;

        try {
          token = await fetchToken();
        } catch {
          if (!isActiveSession(sessionId)) {
            return;
          }

          console.error("Token request failed");

          endActiveSession("error", "Token error");

          return;
        }

        if (!isActiveSession(sessionId)) {
          return;
        }

        try {
          const audioWasSetUp = await setUpAudio({
            isSessionActive: () => isActiveSession(sessionId),
            onMicrophoneAudio: (audio) => {
              if (
                ws !== connectionSocket ||
                connectionSocket.readyState !== WebSocket.OPEN
              ) {
                return;
              }

              connectionSocket.send(
                JSON.stringify({
                  type: "input.audio",
                  audio,
                })
              );
            },
          });

          if (!audioWasSetUp) {
            return;
          }
        } catch (err) {
          if (!isActiveSession(sessionId)) {
            return;
          }

          if (err.stage === "microphone") {
            console.error("Mic permission denied:", err.cause);
            endActiveSession("error", "Mic blocked");
          } else {
            console.error("Audio setup error:", err.cause);
            endActiveSession("error", "Audio setup error");
          }

          return;
        }

        setStatus(
          "connecting",
          "Connecting…"
        );

        try {
          connectionSocket = new WebSocket(
            `${WS_URL}?token=${encodeURIComponent(
              token
            )}`
          );
        } catch (err) {
          console.error("WebSocket setup error:", err);
          endActiveSession("error", "Connection error");
          return;
        }

        if (!isActiveSession(sessionId)) {
          closeWebSocket(connectionSocket);
          return;
        }

        ws = connectionSocket;

        connectionSocket.binaryType = "arraybuffer";

        connectionSocket.onopen = () => {
          if (!isActiveSession(sessionId)) {
            closeWebSocket(connectionSocket);
            return;
          }

          const now = new Date();

          const today = [
            now.getFullYear(),
            String(
              now.getMonth() + 1
            ).padStart(2, "0"),
            String(
              now.getDate()
            ).padStart(2, "0"),
          ].join("-");

          const voiceAgentSettings = getVoiceAgentSettings();

          connectionSocket.send(
            JSON.stringify({
              type: "session.update",

              session: {
                system_prompt:
                  voiceAgentSettings.prompt +
                  `\n\nToday's date is ${today}. Use this to interpret relative calendar dates such as Friday, Wednesday, or the 28th.`,

                greeting:
                  voiceAgentSettings.greeting,

                input: {
  turn_detection: {
    vad_threshold: 0.5,
    min_silence: 1000,
    max_silence: 3000,
    interrupt_response: true,
  },
},

                output: {
                  voice:
                    voiceAgentSettings.voice,
                },

                tools: VOICE_TOOLS,
              },
            })
          );
        };

        connectionSocket.onmessage = (event) => {
          if (!isActiveSession(sessionId)) {
            return;
          }

          handleEvent(
            JSON.parse(
              event.data
            ),
            sessionId
          );
        };

        connectionSocket.onerror = (err) => {
          if (!isActiveSession(sessionId)) {
            return;
          }

          console.error(
            "WebSocket error:",
            err
          );

          endActiveSession(
            "error",
            "Connection error"
          );
        };

        connectionSocket.onclose = (event) => {
          if (!isActiveSession(sessionId)) {
            return;
          }

          console.log(
            "WebSocket closed:",
            event.code
          );

          endActiveSession();
        };

      }

      function handleEvent(event, sessionId) {
        if (!isActiveSession(sessionId)) {
          return;
        }

        if (
          event.type !==
          "reply.audio"
        ) {
          console.log(
            "AssemblyAI event:",
            event.type
          );
        }

        switch (event.type) {
          case "session.ready":
            console.log("Voice session ready");

            setStatus(
              "connected",
              `Connected (${event.session_id})`
            );

            setDisconnectButtonDisabled(false);

            startMicrophoneCapture();

            break;

          case "session.updated":
            console.log("Voice session updated");

            break;

          case "input.speech.started":
            toolResultCoordinator.setReplyDone(false);
            break;

          case "transcript.user.delta":
            updateUserPartialTranscript(event.text);

            break;

          case "transcript.user":
          if (event.text?.trim()) {
            codexCallTracker.cancelSupersededCalls(
              sessionId,
              activeToolTurnId
            );
    invalidateToolTurn();
  }

            finalizeUserTranscript(event.text);

            break;

          case "reply.started":
            toolResultCoordinator.setReplyDone(false);
            break;

          case "reply.audio":
            playPCM(
              event.data,
              () => isActiveSession(sessionId)
            );
            break;

          case "transcript.agent": {
            const meta =
              event.interrupted
                ? "interrupted"
                : null;

            addBubble(
              "agent",
              event.text,
              meta
            );

            break;
          }

          case "tool.call":  const toolTurnId = activeToolTurnId;

  toolResultCoordinator.startTask();

            handleToolCall(event, sessionId, toolTurnId)
              .catch(() => {
                console.error("Tool handler failed");
              })
              .finally(() => {
                if (!isActiveToolTurn(sessionId, toolTurnId)) {
                  return;
                }

                toolResultCoordinator.finishTask();

                toolResultCoordinator.flush(sessionId, toolTurnId);
              });

            break;

          case "reply.done":
            if (
              event.status ===
              "interrupted"
            ) {
              flushPlayback();

              invalidateToolTurn();
            } else {
              toolResultCoordinator.setReplyDone(true);

              toolResultCoordinator.flush(sessionId, activeToolTurnId);
            }

            break;

          case "session.error":
            console.error(
              "Session error:",
              event.code
            );

            setStatus(
              "error",
              `${event.code}: ${event.message}`
            );

            break;
        }
      }

      async function handleToolCall(
        event,
        sessionId,
        toolTurnId
      ) {
        console.log(
          "Tool called:",
          event.name
        );

        // ---------------------------------
        // OPEN WEBSITE
        // ---------------------------------

        if (
          event.name ===
          "open_website"
        ) {
          const result = openWebsite(event.arguments?.site);

          toolResultCoordinator.queueResult(sessionId, toolTurnId, event.call_id, result);

          return;
        }

        // ---------------------------------
        // GOOGLE CALENDAR
        // ---------------------------------

        if (event.name === "get_calendar_events") {
          const result = await getCalendarEvents(event.arguments?.when);

          toolResultCoordinator.queueResult(sessionId, toolTurnId, event.call_id, result);

          return;
        }
// ---------------------------------
// CODEX
// ---------------------------------

if (event.name === "ask_codex") {
  codexCallTracker.registerCall(sessionId, toolTurnId, event.call_id);

  const task = event.arguments?.task;

  if (task) {
    showToolStatus(
  "Codex is checking your project…",
  sessionId,
  toolTurnId,
  isActiveToolTurn
);
  }

  const result = await runCodexTask(task);
  clearToolStatus(sessionId, toolTurnId);

  toolResultCoordinator.queueResult(sessionId, toolTurnId, event.call_id, result);

  return;
}

// ---------------------------------
// UNKNOWN TOOL
// ---------------------------------

toolResultCoordinator.queueResult(sessionId, toolTurnId, event.call_id, {
  success: false,
  error: `Unknown tool: ${event.name}`,
});

      }


      function sendToolResult(sessionId, toolTurnId, callId, result) {
        if (
          !isActiveToolTurn(sessionId, toolTurnId) ||
          !ws ||
          ws.readyState !== WebSocket.OPEN
        ) {
          return false;
        }

        ws.send(
          JSON.stringify({
            type: "tool.result",
            call_id: callId,
            result: JSON.stringify(result),
          })
        );

        return true;
      }

      function teardown(statusState = "", statusText = "Disconnected") {
        const socket = ws;

        invalidateToolTurn();
        codexCallTracker.clear();

        ws = null;

        closeWebSocket(socket);
        tearDownAudio();
        resetUserPartialTranscript();
        setStatus(statusState, statusText);
        setConnectButtonDisabled(false);
        setDisconnectButtonDisabled(true);
      }

      function disconnect() {
        endActiveSession();
      }

      function closeWebSocket(socket) {
        if (
          !socket ||
          socket.readyState === WebSocket.CLOSING ||
          socket.readyState === WebSocket.CLOSED
        ) {
          return;
        }

        try {
          socket.close();
        } catch (err) {
          console.error("WebSocket close error:", err);
        }
      }

      bindControls(connect, disconnect);
