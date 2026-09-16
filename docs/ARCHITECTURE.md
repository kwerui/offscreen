# Offscreen Architecture

## What Offscreen is

Offscreen is a local, voice-first computer companion for the AssemblyAI Voice
Agent Hackathon. Its purpose is to let a user complete a few routine digital
tasks with less screen and keyboard interaction.

The current product can converse through AssemblyAI, open a supported website,
read the user's Google Calendar, and ask a local Codex CLI to inspect the local
software project. Google Calendar access is read-only.

This document distinguishes **current architecture** (code that exists today)
from **proposed architecture** (a future cleanup plan). Do not assume a
proposed file or module already exists.

## Current repository structure

```text
server.js                 Express server and backend API routes
calendar.js               Google Calendar authentication and queries
calendar-query.js         Deterministic Calendar query interpretation
test/calendar-query.test.js  Node tests for Calendar query interpretation
public/
  index.html              Browser UI and nearly all browser application logic
  pcm-processor.js        AudioWorklet for microphone PCM conversion
.env.example              Names the required AssemblyAI environment variable
offscreen.zip             Tracked release/archive artifact
docs/                     Project documentation
```

## Current file responsibilities

### `server.js`

`server.js` starts Express, serves `public/`, and reads the AssemblyAI API key
from the server environment. It currently owns several different concerns:

- `GET /api/voice-token` mints a short-lived AssemblyAI token for the browser;
- Calendar HTTP routes validate requests and call `calendar.js`;
- the Calendar query route validates input, calls `calendar-query.js`, and
  chooses the appropriate Calendar query;
- `POST /api/codex` starts a local read-only Codex CLI process;
- static-file serving and server startup.

The file is an entry point, but it has grown beyond simple application assembly.

### `calendar.js`

`calendar.js` owns Google Calendar access. It authenticates using local OAuth
credentials, caches the authentication client in memory, looks up the primary
Calendar timezone, computes ranges, queries events, and converts Google event
records into the smaller object returned to the browser.

It uses the read-only Google Calendar scope. Google credentials remain on the
server/local machine and are not sent to the browser.

### `public/index.html`

`index.html` is currently both the web page and the browser application. It
contains:

- page markup and CSS;
- configuration controls for voice, greeting, and system prompt;
- AssemblyAI WebSocket connection setup and event handling;
- microphone permission, AudioContext, and PCM upload setup;
- synthesized PCM playback scheduling;
- transcript and status rendering;
- AssemblyAI tool definitions;
- browser-side website, Calendar, and Codex tool handling;
- asynchronous tool-result queues and connection lifecycle state.

This works as a compact prototype, but it is the main concentration of
responsibility in the repository.

### `public/pcm-processor.js`

This focused AudioWorklet receives microphone samples as floating-point values,
converts them to 16-bit signed PCM, and sends each frame to the main browser
thread. It has one clear job and does not need a structural change now.

### `calendar-query.js`

`calendar-query.js` contains the deterministic portion of Calendar query
interpretation: named ranges, bare day-of-month handling, natural-language date
parsing, and date formatting. It does not make HTTP or Google API requests, so
it can be tested without credentials or network access.

### `test/calendar-query.test.js`

This Node built-in test suite protects the current Calendar query behavior,
including supported ranges, natural-language dates, bare ordinal dates, and
important month-boundary cases.

### `offscreen.zip`

This is an archive artifact, not application code. The audit found that its
copies of `server.js` and `public/index.html` differ from the current tracked
source, so it must be regenerated from the exact release commit before
submission.

## Current request and data flow

```text
Microphone
  → browser AudioWorklet converts Float32 audio to PCM
  → browser sends base64 PCM over WebSocket
  → AssemblyAI Voice Agent
  → transcript, reply audio, or tool.call event
  → browser tool handler
       → open_website: browser opens an allowlisted URL
       → get_calendar_events: browser calls local Calendar API
            → Google Calendar API
       → ask_codex: browser calls local Codex API
            → read-only local Codex CLI
  → browser queues tool.result
  → browser sends tool.result to AssemblyAI
  → AssemblyAI sends spoken reply PCM and transcript
  → browser schedules audio playback and displays the transcript
```

### AssemblyAI voice flow

1. The browser calls `GET /api/voice-token`.
2. The server uses `ASSEMBLYAI_API_KEY` to request a temporary token. The API
   key itself never goes to the browser.
3. The browser creates an AssemblyAI Voice Agent WebSocket using that token.
4. When the session is ready, the browser sends its prompt, greeting, selected
   voice, and available tool definitions.
5. The browser connects microphone capture after the Voice Agent session is
   ready and sends PCM audio frames.
6. AssemblyAI sends transcript events and agent PCM audio events; the browser
   renders the transcript and schedules audio playback.

### Tool-call flow

AssemblyAI sends a `tool.call` event. The browser dispatches it by tool name,
performs the requested browser or backend action, adds a result to a pending
queue, and later sends `tool.result` messages when the reply/tool timing allows.
The current implementation tracks this with shared counters and arrays in
`index.html`.

### Google Calendar flow

The `get_calendar_events` browser tool sends the requested natural-language
time to `GET /api/calendar/query`. `server.js` passes the query to
`calendar-query.js`, which recognizes named ranges such as `today` or returns
a parsed date. `calendar.js` asks Google for events in the primary Calendar
timezone and returns a simplified event list. The browser returns that data to
AssemblyAI as a tool result.

### Codex flow

The `ask_codex` browser tool sends its task to `POST /api/codex`. The server
starts `codex exec` with a read-only sandbox and returns its stdout as the tool
result. This is intended for a trusted, local development/demo environment.

## Current frontend/backend boundary

The browser owns user interface, microphone capture, audio playback, AssemblyAI
WebSocket communication, browser-only actions, and transcript display.

The backend owns secrets, AssemblyAI token minting, Google OAuth credentials,
Google Calendar access, Codex process execution, server-side validation, and
HTTP APIs. Never move private API keys or Google OAuth credentials into browser
code.

## Current external integrations

| Integration | Current use | Boundary |
| --- | --- | --- |
| AssemblyAI Voice Agent | Conversation, transcription, reply audio, and tool calls | Browser holds only a temporary token; server holds the API key. |
| Google Calendar API | Read-only Calendar queries | Server-only OAuth and API client. |
| Codex CLI | Read-only local repository inspection | Server starts the local process; browser receives a result. |
| Browser tabs | Opening a small allowlist of websites | Browser-only action; no backend needed. |

## Known architectural problems

These are audit findings, not evidence that every path currently fails.

- `index.html` combines many unrelated jobs, making future changes difficult to
  understand and test.
- Each voice connection has a monotonically increasing session ID. Disconnect
  invalidates that ID before closing the socket and releasing microphone/audio
  resources, so callbacks from an older connection are ignored.
- Each tool call captures its originating session ID. Late Calendar or Codex
  completions are ignored after disconnect/reconnect instead of altering the
  current session's queue, counters, or tool-status display.
- The Codex tool declares a shorter voice timeout than the server process
  timeout, which can create late-result behavior.
- Natural-language dates are parsed in server time while Calendar queries use
  Calendar time, which can be wrong near timezone boundaries.
- `calendar.js` duplicates Calendar client/timezone/event-formatting work in
  its two exported functions.
- Calendar parsing is isolated and covered by Node tests, but Calendar
  timezone handling remains a later concern.
- Multiple Calendar endpoints exist, but only the query endpoint has a
  current in-repository browser caller.
- The initial automated suite covers only deterministic Calendar-query logic;
  integration behavior still needs manual verification.
- `offscreen.zip` is stale and must not be trusted as a release artifact.

## Proposed target architecture

The following is a **proposal**, not the current folder structure. It preserves
the current stack: Express on the backend and plain browser JavaScript on the
frontend.

```text
server.js                         application assembly and static hosting
  routes/voice.js                 proposed token endpoint
  routes/calendar.js              proposed Calendar HTTP validation
  routes/codex.js                 proposed Codex HTTP validation
  calendar-query.js               existing pure calendar parser
  calendar.js                     Google OAuth and event fetching
  codex-runner.js                 proposed bounded Codex process runner

public/
  index.html                      markup, CSS, controls, module entry point
  app.js                          proposed browser orchestration
  voice-session.js                proposed AssemblyAI session lifecycle
  audio.js                        proposed microphone and playback logic
  tools.js                        proposed tool definitions and execution
  ui.js                           proposed transcript/status rendering
  pcm-processor.js                existing AudioWorklet
```

Do not create all these modules at once. Extract one responsibility only when
tests and manual verification protect the current behavior.

## Proposed module responsibilities

| Proposed module | Single responsibility |
| --- | --- |
| `server.js` | Assemble Express, configure middleware, mount routes, start the server. |
| `routes/voice.js` | Validate and serve temporary Voice Agent token requests. |
| `routes/calendar.js` | Validate Calendar HTTP input and translate service outcomes to HTTP responses. |
| `routes/codex.js` | Validate Codex task requests and return safe, bounded results. |
| `calendar-query.js` | Existing module: parse a supported range or natural-language date without HTTP or Google access. |
| `calendar.js` | Authenticate with Google, obtain Calendar context, fetch, and format events. |
| `codex-runner.js` | Start, time-limit, and normalize the read-only Codex process. |
| `app.js` | Coordinate UI actions and one active voice session. |
| `voice-session.js` | Own WebSocket messages, session generation, and stale-event protection. |
| `audio.js` | Capture, convert/send, schedule, stop, and clean up audio. |
| `tools.js` | Define supported tools and return a normalized tool result. |
| `ui.js` | Update status and transcript DOM elements. |

## Rules for deciding where new code belongs

1. Put browser-only behavior in `public/`: UI, microphone, playback,
   WebSocket handling, and opening browser tabs.
2. Put secrets, OAuth, external-service credentials, and server validation on
   the backend.
3. Put an external service's API-specific logic in its integration module.
4. Put deterministic logic that does not need HTTP or network access in a
   small pure module. That makes it easy to test.
5. Keep entry points as assembly/orchestration code. Do not keep adding feature
   details to `server.js` or the browser entry script indefinitely.
6. Do not create a module just because a name is available. Extract only when
   it gives one clear responsibility or removes real duplication.

## Why React is not currently being adopted

React would help most with declarative UI components. It would not solve the
harder current problems: microphone lifecycle, WebSocket timing, audio
scheduling, tool-result isolation, Google access, or Codex process management.

A pre-hackathon React migration would require a broad rewrite, build tooling,
new dependencies, and regression risk while the existing demo needs reliability
first. Native browser ES modules can improve readability without changing the
framework. Reconsider React after the hackathon only if the UI grows into
several independently complex, reusable screens.
