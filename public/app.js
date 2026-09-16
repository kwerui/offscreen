      const SAMPLE_RATE = 24_000;
      const WS_URL =
        "wss://agents.assemblyai.com/v1/ws";

      const SITE_URLS = {
        github: "https://github.com",
        youtube: "https://youtube.com",
        assemblyai: "https://www.assemblyai.com/docs",
        gmail: "https://mail.google.com",
        calendar: "https://calendar.google.com",
      };

      const els = {
        connect: document.getElementById("connect"),
        disconnect: document.getElementById("disconnect"),
        clear: document.getElementById("clear"),
        voice: document.getElementById("voice"),
        prompt: document.getElementById("prompt"),
        greeting: document.getElementById("greeting"),
        transcript: document.getElementById("transcript"),
        empty: document.getElementById("empty"),
        statusDot: document.getElementById("status-dot"),
        statusText: document.getElementById("status-text"),
      };

      let ws = null;
      let audioCtx = null;
      let micStream = null;
      let workletNode = null;
      let micSource = null;
      let activeSessionId = 0;

      let playbackTime = 0;
      let scheduledSources = [];
      let userPartialEl = null;

      let pendingToolResults = [];
      let activeToolTasks = 0;
      let toolReplyDone = false;
      let activeToolTurnId = 0;
      const unresolvedCodexCalls = new Map();

      let toolStatusElement = null;
let toolStatusTimer = null;
let toolStatusStartedAt = null;
let toolStatusSessionId = null;
let toolStatusTurnId = null;

      function setStatus(state, text) {
        els.statusDot.className = "dot " + state;
        els.statusText.textContent = text;
      }

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

      function clearTranscript() {
        els.transcript.innerHTML = "";
        els.transcript.appendChild(els.empty);
        userPartialEl = null;
      }

      function ensureBubble(role, partial = false) {
        if (els.empty.parentNode) {
          els.empty.remove();
        }

        const div = document.createElement("div");

        div.className =
          "bubble " +
          role +
          (partial ? " partial" : "");

        els.transcript.appendChild(div);
        els.transcript.scrollTop =
          els.transcript.scrollHeight;

        return div;
      }

      function addBubble(role, text, meta) {
        const div = ensureBubble(role);

        div.textContent = text;

        if (meta) {
          const span =
            document.createElement("span");

          span.className = "meta";
          span.textContent = meta;

          div.appendChild(span);
        }

        els.transcript.scrollTop =
          els.transcript.scrollHeight;
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

        if (ws || audioCtx || micStream) {
          activeSessionId = sessionId;
          teardown();
        } else {
          activeSessionId = sessionId;
        }

        els.connect.disabled = true;

        setStatus(
          "connecting",
          "Requesting token…"
        );

        let token;

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

        let connectionAudioContext;

        try {
          connectionAudioContext = new (
            window.AudioContext ||
            window.webkitAudioContext
          )({
            sampleRate: SAMPLE_RATE,
          });
        } catch (err) {
          console.error("Audio context error:", err);
          endActiveSession("error", "Audio setup error");
          return;
        }

        if (!isActiveSession(sessionId)) {
          closeAudioContext(connectionAudioContext);
          return;
        }

        audioCtx = connectionAudioContext;

        playbackTime =
          connectionAudioContext.currentTime;

        scheduledSources = [];

        try {
          const capturedMicrophoneStream =
            await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1,
              },
            });

          if (!isActiveSession(sessionId)) {
            stopMicrophoneTracks(capturedMicrophoneStream);
            return;
          }

          micStream = capturedMicrophoneStream;
        } catch (err) {
          if (!isActiveSession(sessionId)) {
            return;
          }

          console.error(
            "Mic permission denied:",
            err
          );

          endActiveSession(
            "error",
            "Mic blocked"
          );

          return;
        }

        try {
          await connectionAudioContext.audioWorklet.addModule(
            "pcm-processor.js"
          );
        } catch (err) {
          if (!isActiveSession(sessionId)) {
            return;
          }

          console.error("AudioWorklet load error:", err);
          endActiveSession("error", "Audio setup error");
          return;
        }

        if (!isActiveSession(sessionId)) {
          return;
        }

        try {
          micSource =
            connectionAudioContext.createMediaStreamSource(
              micStream
            );

          workletNode =
            new AudioWorkletNode(
              connectionAudioContext,
              "pcm-processor"
            );
        } catch (err) {
          console.error("Audio node setup error:", err);
          endActiveSession("error", "Audio setup error");
          return;
        }

        setStatus(
          "connecting",
          "Connecting…"
        );

        let connectionSocket;

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

          connectionSocket.send(
            JSON.stringify({
              type: "session.update",

              session: {
                system_prompt:
                  els.prompt.value +
                  `\n\nToday's date is ${today}. Use this to interpret relative calendar dates such as Friday, Wednesday, or the 28th.`,

                greeting:
                  els.greeting.value,

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
                    els.voice.value,
                },

                tools: [
                  {
                    type: "function",

                    name:
                      "open_website",

                    description:
                      "Open one of the supported websites in the user's browser.",

                    parameters: {
                      type: "object",

                      properties: {
                        site: {
                          type:
                            "string",

                          enum: [
                            "github",
                            "youtube",
                            "assemblyai",
                            "gmail",
                            "calendar",
                          ],

                          description:
                            "The supported website to open.",
                        },
                      },

                      required: [
                        "site",
                      ],
                    },
                  },

{
  type: "function",
  name: "get_calendar_events",
description:
  "Check the user's real Google Calendar. ALWAYS call this for ANY question " +
  "about the user's schedule, events, commitments, availability, being free " +
  "or busy, or any named date/day. Dates may use numeric or spoken ordinals, " +
  "for example '2nd of December', 'second of December', 'December 2nd', " +
  "'28th', 'twenty-ninth', or 'Friday'.",
  parameters: {
    type: "object",
    properties: {
      when: {
        type: "string",
description:
  "The requested time period or date, for example upcoming, today, tomorrow, this month, September 23rd, 23rd of September, December 1st, 1st of December, 28th, or Friday.",
      },
    },
    required: ["when"],
  },

  execution_mode: "hold",
  timeout_seconds: 15,
},

{
  type: "function",

  name: "ask_codex",

  description:
    "Use Codex to inspect the user's local software project. " +
    "Call this immediately whenever the user explicitly asks Codex " +
    "to inspect, review, debug, explain, or analyze the project or its code. " +
    "Do not ask for confirmation when the request is understandable.",

  parameters: {
    type: "object",

    properties: {
      task: {
        type: "string",

        description:
          "The complete request to send to Codex. " +
          "Preserve the user's actual request as closely as possible.",
      },
    },

    required: ["task"],
  },

  execution_mode: "interactive",
  timeout_seconds: 45,
}
                ],
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

        workletNode.port.onmessage = (
          event
        ) => {
          if (
            !isActiveSession(sessionId) ||
            ws !== connectionSocket ||
            connectionSocket.readyState !==
              WebSocket.OPEN
          ) {
            return;
          }

          const audio =
            arrayBufferToBase64(
              event.data
            );

          connectionSocket.send(
            JSON.stringify({
              type: "input.audio",
              audio,
            })
          );
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

            els.disconnect.disabled =
              false;

            micSource.connect(
              workletNode
            );

            break;

          case "session.updated":
            console.log("Voice session updated");

            break;

          case "input.speech.started":
            toolReplyDone = false;
            break;

          case "transcript.user.delta":
            if (!userPartialEl) {
              userPartialEl =
                ensureBubble(
                  "user",
                  true
                );
            }

            userPartialEl.textContent =
              event.text;

            els.transcript.scrollTop =
              els.transcript.scrollHeight;

            break;

          case "transcript.user":
          if (event.text?.trim()) {
            cancelSupersededCodexCalls(sessionId, activeToolTurnId);
    invalidateToolTurn();
  }

  if (userPartialEl) {
              userPartialEl.classList.remove(
                "partial"
              );

              userPartialEl.textContent =
                event.text;

              userPartialEl = null;
            } else {
              addBubble(
                "user",
                event.text
              );
            }

            break;

          case "reply.started":
            toolReplyDone = false;
            break;

          case "reply.audio":
            playPCM(
              event.data,
              sessionId
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
          const site =
            event.arguments?.site;

          const url =
            SITE_URLS[site];

          if (!url) {
            addToolResult(sessionId, toolTurnId, event.call_id, {
              success: false,
              error: `Unsupported website: ${site}`,
            });

            return;
          }

          try {
            console.log(
              `Opening ${site}:`,
              url
            );

            const openedWindow =
              window.open(
                url,
                "_blank"
              );

            if (!openedWindow) {
              throw new Error(
                "The browser blocked the new tab."
              );
            }

            addToolResult(sessionId, toolTurnId, event.call_id, {
              success: true,
              site,
              url,
            });
          } catch (err) {
            addToolResult(sessionId, toolTurnId, event.call_id, {
              success: false,
              error: err.message,
            });
          }

          return;
        }

        // ---------------------------------
        // GOOGLE CALENDAR
        // ---------------------------------

        if (event.name === "get_calendar_events") {
  try {
    const when = event.arguments?.when;

    if (!when) {
      throw new Error(
        "Calendar time period is required."
      );
    }

    console.log("Calendar tool started");

    const response = await fetch(
      `/api/calendar/query?when=${encodeURIComponent(when)}`
    );

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(
        `Calendar request failed with status ${response.status}: ${errorText}`
      );
    }

    const data = await response.json();

    console.log(
      `Calendar tool completed: ${(data.events || []).length} events`
    );

    addToolResult(sessionId, toolTurnId, event.call_id, {
      success: true,
      requested_when: when,
      timezone: data.timezone,
      events: data.events || [],
    });
  } catch (err) {
    console.error("Calendar tool failed");

    addToolResult(sessionId, toolTurnId, event.call_id, {
      success: false,
      error: err.message,
    });
  }

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

  try {
    const task = event.arguments?.task;

    if (!task) {
      throw new Error("Codex task is required.");
    }

    console.log("Codex tool started");

    showToolStatus(
  "Codex is checking your project…",
  sessionId,
  toolTurnId
);

    const response = await fetch("/api/codex", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ task }),
    });

    if (!response.ok) {
      const errorText = await response.text();

throw new Error(
  `Codex request failed with status ${response.status}: ${errorText}`
);
    }

    const data = await response.json();
    clearToolStatus(sessionId, toolTurnId);
    console.log("Codex tool completed");

    addToolResult(sessionId, toolTurnId, event.call_id, {
      success: true,
      output: data.output,
    });
  } catch (err) {
    clearToolStatus(sessionId, toolTurnId);
    console.error("Codex tool failed");

    addToolResult(sessionId, toolTurnId, event.call_id, {
      success: false,
      error: err.message,
    });
  }

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

      function showToolStatus(message, sessionId, toolTurnId) {
  if (!isActiveToolTurn(sessionId, toolTurnId)) {
    return;
  }

  clearToolStatus();

  toolStatusStartedAt = Date.now();
  toolStatusSessionId = sessionId;
  toolStatusTurnId = toolTurnId;

  toolStatusElement = ensureBubble(
    "agent",
    true
  );

  function updateStatus() {
    if (
      !isActiveToolTurn(sessionId, toolTurnId) ||
      toolStatusSessionId !== sessionId ||
      toolStatusTurnId !== toolTurnId
    ) {
      return;
    }

    const seconds = Math.floor(
      (Date.now() - toolStatusStartedAt) / 1000
    );

    toolStatusElement.textContent =
      `${message} ${seconds}s`;
  }

  updateStatus();

  toolStatusTimer = setInterval(
    updateStatus,
    1000
  );
}

function clearToolStatus(sessionId, toolTurnId) {
  if (
    sessionId !== undefined &&
    toolStatusSessionId !== sessionId
  ) {
    return;
  }

  if (
    toolTurnId !== undefined &&
    toolStatusTurnId !== toolTurnId
  ) {
    return;
  }

  if (toolStatusTimer) {
    clearInterval(toolStatusTimer);
    toolStatusTimer = null;
  }

  if (toolStatusElement) {
    toolStatusElement.remove();
    toolStatusElement = null;
  }

  toolStatusStartedAt = null;
  toolStatusSessionId = null;
  toolStatusTurnId = null;
}

      function playPCM(b64, sessionId) {
        const bytes =
          Uint8Array.from(
            atob(b64),
            (char) =>
              char.charCodeAt(0)
          );

        const int16 =
          new Int16Array(
            bytes.buffer,
            bytes.byteOffset,
            bytes.byteLength / 2
          );

        const float32 =
          new Float32Array(
            int16.length
          );

        for (
          let i = 0;
          i < int16.length;
          i++
        ) {
          float32[i] =
            int16[i] /
            0x8000;
        }

        const buffer =
          audioCtx.createBuffer(
            1,
            float32.length,
            SAMPLE_RATE
          );

        buffer
          .getChannelData(0)
          .set(float32);

        const source =
          audioCtx.createBufferSource();

        source.buffer =
          buffer;

        source.connect(
          audioCtx.destination
        );

        const now =
          audioCtx.currentTime;

        if (
          playbackTime < now
        ) {
          playbackTime = now;
        }

        source.start(
          playbackTime
        );

        playbackTime +=
          buffer.duration;

        scheduledSources.push(
          source
        );

        source.onended = () => {
          if (!isActiveSession(sessionId)) {
            return;
          }

          scheduledSources =
            scheduledSources.filter(
              (item) =>
                item !== source
            );
        };
      }

      function flushPlayback() {
        for (
          const source of
          scheduledSources
        ) {
          try {
            source.stop();
          } catch (_) {}
        }

        scheduledSources = [];

        if (audioCtx) {
          playbackTime =
            audioCtx.currentTime;
        }
      }

      function teardown(statusState = "", statusText = "Disconnected") {
        const socket = ws;
        const audioContext = audioCtx;
        const microphoneStream = micStream;
        const processor = workletNode;
        const microphoneSource = micSource;

        invalidateToolTurn();
        unresolvedCodexCalls.clear();
        flushPlayback();

        ws = null;
        audioCtx = null;
        micStream = null;
        workletNode = null;
        micSource = null;

        closeWebSocket(socket);
        disconnectAudioNode(processor);
        disconnectAudioNode(microphoneSource);
        stopMicrophoneTracks(microphoneStream);
        closeAudioContext(audioContext);

        userPartialEl = null;

        setStatus(statusState, statusText);

        els.connect.disabled =
          false;

        els.disconnect.disabled =
          true;
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

      function arrayBufferToBase64(
        buffer
      ) {
        const bytes =
          new Uint8Array(
            buffer
          );

        let binary = "";

        const chunk =
          0x8000;

        for (
          let i = 0;
          i < bytes.length;
          i += chunk
        ) {
          binary +=
            String.fromCharCode.apply(
              null,
              bytes.subarray(
                i,
                i + chunk
              )
            );
        }

        return btoa(binary);
      }

      els.connect.addEventListener(
        "click",
        connect
      );

      els.disconnect.addEventListener(
        "click",
        disconnect
      );

      els.clear.addEventListener(
        "click",
        clearTranscript
      );
