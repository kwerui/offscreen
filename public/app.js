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

      const WS_URL =
        "wss://agents.assemblyai.com/v1/ws";

      let ws = null;
      let activeSessionId = 0;

      let pendingToolResults = [];
      let activeToolTasks = 0;
      let toolReplyDone = false;
      let activeToolTurnId = 0;
      const unresolvedCodexCalls = new Map();

      function isActiveSession(sessionId) {
        return sessionId === activeSessionId;
      }

      function isActiveToolTurn(sessionId, toolTurnId) {
        return (
          isActiveSession(sessionId) &&
          toolTurnId === activeToolTurnId
        );
      }

      function invalidateToolTurn() {
        activeToolTurnId++;
        pendingToolResults = [];
        activeToolTasks = 0;
        toolReplyDone = false;
        clearToolStatus();
      }

      function cancelSupersededCodexCalls(sessionId, toolTurnId) {
        for (const [callId, codexCall] of unresolvedCodexCalls) {
          if (
            codexCall.sessionId !== sessionId ||
            codexCall.toolTurnId !== toolTurnId
          ) {
            continue;
          }

          const wasSent = sendToolResult(
            sessionId,
            toolTurnId,
            codexCall.callId,
            {
              success: false,
              cancelled: true,
              error: "Superseded by a newer user request.",
            }
          );

          if (wasSent) {
            unresolvedCodexCalls.delete(callId);
            console.log("Superseded Codex tool cancelled");
          }
        }
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
            toolReplyDone = false;
            break;

          case "transcript.user.delta":
            updateUserPartialTranscript(event.text);

            break;

          case "transcript.user":
          if (event.text?.trim()) {
            cancelSupersededCodexCalls(sessionId, activeToolTurnId);
    invalidateToolTurn();
  }

            finalizeUserTranscript(event.text);

            break;

          case "reply.started":
            toolReplyDone = false;
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

  activeToolTasks++;

            handleToolCall(event, sessionId, toolTurnId)
              .catch(() => {
                console.error("Tool handler failed");
              })
              .finally(() => {
                if (!isActiveToolTurn(sessionId, toolTurnId)) {
                  return;
                }

                activeToolTasks--;

                maybeSendToolResults(sessionId, toolTurnId);
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
              toolReplyDone = true;

              maybeSendToolResults(sessionId, activeToolTurnId);
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

          addToolResult(sessionId, toolTurnId, event.call_id, result);

          return;
        }

        // ---------------------------------
        // GOOGLE CALENDAR
        // ---------------------------------

        if (event.name === "get_calendar_events") {
          const result = await getCalendarEvents(event.arguments?.when);

          addToolResult(sessionId, toolTurnId, event.call_id, result);

          return;
        }
// ---------------------------------
// CODEX
// ---------------------------------

if (event.name === "ask_codex") {
  unresolvedCodexCalls.set(event.call_id, {
    sessionId,
    toolTurnId,
    callId: event.call_id,
  });

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

  addToolResult(sessionId, toolTurnId, event.call_id, result);

  return;
}

// ---------------------------------
// UNKNOWN TOOL
// ---------------------------------

addToolResult(sessionId, toolTurnId, event.call_id, {
  success: false,
  error: `Unknown tool: ${event.name}`,
});

      }


      function addToolResult(sessionId, toolTurnId, callId, result) {
        if (!isActiveToolTurn(sessionId, toolTurnId)) {
          return;
        }

        pendingToolResults.push({
          call_id: callId,
          result,
        });
      }

      function maybeSendToolResults(sessionId, toolTurnId) {
        if (!isActiveToolTurn(sessionId, toolTurnId)) {
          return;
        }

        if (!toolReplyDone) {
          return;
        }

        if (
          activeToolTasks > 0
        ) {
          return;
        }

        if (
          pendingToolResults.length ===
          0
        ) {
          return;
        }

        console.log(
          `Sending ${pendingToolResults.length} tool result(s)`
        );

        sendPendingToolResults(sessionId, toolTurnId);

        toolReplyDone = false;
      }

      function sendPendingToolResults(sessionId, toolTurnId) {
        if (
          !isActiveToolTurn(sessionId, toolTurnId) ||
          !ws ||
          ws.readyState !==
            WebSocket.OPEN
        ) {
          return;
        }

        for (
          const tool of
          pendingToolResults
        ) {
          const wasSent = sendToolResult(
            sessionId,
            toolTurnId,
            tool.call_id,
            tool.result
          );

          if (wasSent) {
            unresolvedCodexCalls.delete(tool.call_id);
          }
        }

        pendingToolResults = [];
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
        unresolvedCodexCalls.clear();

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
