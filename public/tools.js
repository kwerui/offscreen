export const VOICE_TOOLS = [
  {
    type: "function",

    name: "disconnect_session",

    description:
      "End the current Offscreen voice session only when the user explicitly asks " +
      "Offscreen to disconnect or end the session. Do not call this when the " +
      "user merely mentions disconnecting in another context.",

    parameters: {
      type: "object",

      properties: {},

      required: [],
    },
  },

  {
    type: "function",

    name: "pause_listening",

    description:
      "Use only when the user explicitly asks Offscreen to pause listening, stop " +
      "listening, or go on standby. Enter standby mode while keeping the voice " +
      "session connected. In standby, Offscreen should only handle requests to " +
      "resume listening or disconnect.",

    parameters: {
      type: "object",

      properties: {},

      required: [],
    },
  },

  {
    type: "function",

    name: "cancel_current_work",

    description:
      "Cancel only the current in-progress tool work when the user explicitly " +
      "asks to cancel the current task or stop what Offscreen is doing. Do not " +
      "call this for casual mentions of cancel or stop.",

    parameters: {
      type: "object",

      properties: {},

      required: [],
    },
  },

  {
    type: "function",

    name: "repeat_last_response",

    description:
      "Use only when the user explicitly asks Offscreen to repeat its most " +
      "recent completed spoken response, such as 'repeat that', 'say that " +
      "again', or 'what did you just say'. Do not repeat the user's words, " +
      "explain or summarize an earlier response, or rerun any previous tool.",

    parameters: {
      type: "object",

      properties: {},

      required: [],
    },
  },

  {
    type: "function",

    name: "summarize_last_response",

    description:
      "Use only when the user explicitly asks Offscreen to shorten, summarize, " +
      "condense, give a TL;DR, or provide a shorter version of its most recent " +
      "completed spoken response. Do not use this to repeat verbatim, summarize " +
      "the user's words, explain an earlier response, or rerun any previous tool.",

    parameters: {
      type: "object",

      properties: {},

      required: [],
    },
  },

  {
    type: "function",

    name: "open_website",

    description:
      "Open one of the supported websites in the user's browser.",

    parameters: {
      type: "object",

      properties: {
        site: {
          type: "string",

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
  },
];
