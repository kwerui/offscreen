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

## Governing principle

**AssemblyAI interprets voice. Offscreen owns state and safety. Tools perform
actions.** AssemblyAI may select a capability from the bounded surface, but
Offscreen remains responsible for lifecycle ownership, input validation,
confirmation, and normalized results.

## Current repository structure

```text
server.js                 Express server and backend API routes
browser-mcp.js            Bounded Playwright MCP client adapter
calendar.js               Google Calendar authentication and queries
calendar-query.js         Deterministic Calendar query interpretation
test/calendar-query.test.js  Node tests for Calendar query interpretation
test/calendar-tool.test.js   Node tests for Calendar HTTP execution
test/codex-tool.test.js      Node tests for Codex HTTP execution
public/
  index.html              Browser UI markup
  styles.css              Page styles
  app.js                  Browser orchestration, event semantics, and tool dispatch
  voice-session.js        AssemblyAI transport and connection lifecycle
  wake-listener.js        Optional disconnected-state browser speech recognition
  codex-call-tracker.js   Codex interactive-call tracking and supersession/cancellation
  tool-result-coordinator.js  Generic tool-result queue/task coordination
  audio.js                Microphone capture and PCM playback
  tools.js                Static AssemblyAI tool definitions
  website-tool.js         Supported website execution
  calendar-tool.js        Calendar HTTP execution
  codex-tool.js           Codex HTTP execution
  git-status-tool.js      Git status HTTP execution
  project-workspace-tool.js  Project search/read HTTP execution
  browser-tool.js         Browser MCP HTTP execution
  ui.js                   DOM lookup and UI rendering
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
- `POST /api/browser` validates one of six bounded browser actions and calls
  `browser-mcp.js`;
- static-file serving and server startup.

The file is an entry point, but it has grown beyond simple application assembly.

### `calendar.js`

`calendar.js` owns Google Calendar access. It authenticates using local OAuth
credentials, caches the authentication client in memory, looks up the primary
Calendar timezone, computes ranges, queries events, and converts Google event
records into the smaller object returned to the browser.

It uses the read-only Google Calendar scope. Google credentials remain on the
server/local machine and are not sent to the browser.

### Browser frontend

### Frontend files

`index.html` contains page markup and configuration controls.

`styles.css` contains page styles.

`ui.js` owns DOM lookup and presentation, including status, transcript
rendering, partial user transcript state, control bindings, and tool-status
bubbles.

`audio.js` owns microphone capture, AudioWorklet setup, PCM encoding and
playback, interruption, and audio cleanup.

`tools.js` exports the static AssemblyAI tool definitions.

`voice-session.js` owns temporary-token fetching, AssemblyAI WebSocket
creation and closure, raw parsed inbound events, and JSON outbound messages.
It does not know about UI, tool names, tool turns, active session IDs, or
event meaning.

`wake-listener.js` owns the optional browser `SpeechRecognition`/
`webkitSpeechRecognition` lifecycle while Offscreen is disconnected. It
matches only the configured wake phrase, restarts after an unexpected normal
end while wake mode remains enabled, and stops before the normal AssemblyAI
connection begins. It does not hold an AssemblyAI token or WebSocket.

`website-tool.js` owns supported-site lookup and opening allowlisted URLs in a
new browser tab.

`calendar-tool.js` owns browser-side Calendar HTTP execution: it calls the
local Calendar endpoint and returns its existing success or failure tool-result
data. It does not coordinate AssemblyAI sessions, tool turns, or results.

`codex-tool.js` owns browser-side Codex HTTP execution: it validates a task,
calls the local Codex endpoint, and returns its existing success or failure
tool-result data. It does not know about AssemblyAI events, interactive-call
tracking, supersession/cancellation, sessions, tool turns, or result queues.

`git-status.js` owns deterministic local Git status inspection. It invokes only
the fixed `git status --porcelain=v1 --branch -z` command in the configured
project root, parses its machine-readable output into branch and safe file
status entries, and normalizes failures without returning process output.

`project-workspace.js` owns deterministic local project search and source-file
reading. It walks only the configured project root with Node filesystem APIs,
uses literal text matching, rejects paths that are not repository-relative, and
does not follow symlinks. One shared exclusion policy hides Git metadata,
dependencies, environment files, credentials, private keys, archives, and
other obvious secret files from both operations. It bounds query/path lengths,
matches, snippets, file sizes, and read ranges; paths and all repository text
are untrusted data rather than instructions.

`project-workspace-tool.js` owns browser-side HTTP execution for the local
project search and read routes. It sends only the tool arguments to fixed
endpoints and returns normalized failures; `app.js` retains session/turn checks
and generic tool-result coordination.

`project-vscode.js` owns the deterministic, LOCAL-only VS Code file-opening
adapter. It reuses the workspace path and text-file policy, accepts only an
existing project-relative file plus an optional bounded line number, and starts
the fixed `code` CLI directly with `shell: false`. It never accepts an
application, executable, command, working directory, environment, or project
root from the browser.

`git-status-tool.js` owns browser-side Git status HTTP execution. It sends no
command, path, or arguments, and returns the server's structured status result.

`browser-tool.js` owns browser-side HTTP execution for the bounded browser
actions and confirmation control requests. It calls the local browser endpoint
and returns normalized results; it does not know about MCP, AssemblyAI sessions,
tool turns, or result queues.

### `browser-mcp.js`

`browser-mcp.js` owns the backend Playwright MCP connection and the one pending
consequential browser-click confirmation. It starts the
locally installed Playwright MCP server lazily in a headless, isolated context,
reuses the connection, verifies its required tools at startup, and maps only
`navigate`, `snapshot`, `find`, `back`, `click`, and `type`. Consequential
clicks are stored with their exact observed ref, description, ref generation,
and expiry instead of executing. Button-like controls require confirmation by
default; only a small observed-label allowlist of low-risk controls may run
immediately. Only the dedicated confirmation path can
execute that stored action once. It accepts only http/https navigation, bounds
output, and normalizes MCP failures. It never forwards an arbitrary MCP tool
name or arguments.

`codex-call-tracker.js` owns unresolved interactive Codex call bookkeeping and
explicit cancellation of calls from a superseded session/turn. It receives a
callback from `app.js` to send cancellation results, so it does not own the
WebSocket, session lifecycle, tool-turn generation, or result coordination.

`tool-result-coordinator.js` owns generic pending tool-result queueing,
active-task tracking, reply-done gating, and ordered result flushing. It
receives callbacks from `app.js` to check turn validity and send results; it
does not own the WebSocket, session lifecycle, a tool implementation, or UI.

`app.js` contains:
- AssemblyAI event semantics and session-update configuration;
- active session IDs, tool-turn ownership, and stale-session checks;
- tool-call identification and execution dispatch;
- Codex tool-call identification, session/turn checks, and the decision to
  supersede an earlier user turn;
- bounded browser tool-call identification and activity descriptions;
- completed user-turn tracking and explicit browser-confirmation gating;
- website and Calendar tool-call identification;
- client-owned descriptions of currently running Calendar/Codex work for
  non-superseding voice status questions;
- tool-result message composition for normal flushing and explicit Codex
  cancellation results.

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

### `test/calendar-tool.test.js`

This Node built-in test suite mocks `fetch` to protect the existing Calendar
request URL and success, HTTP-failure, and network-failure result shapes.

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
       → get_git_status: browser calls local Git status API
            → fixed read-only Git status adapter in the configured project root
       → search_project/read_project_file: browser calls local project workspace APIs
            → bounded Node filesystem search/read adapter in the configured project root
       → open_project_file: browser calls the local project file-opening API
            → validated fixed `code` CLI invocation for one configured-project file
       → browser_*: browser calls local browser API
            → bounded Playwright MCP adapter
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
queue, and later sends `tool.result` messages when the reply/tool timing
allows. Calendar uses `execution_mode: "hold"`; `ask_codex` uses
`execution_mode: "interactive"`. `get_git_status` uses `execution_mode:
"hold"` because it is fast and read-only. It is not cancellable at the process
level; the existing session and tool-turn guards ignore a late completion from
a superseded or disconnected session before it can queue a result or update
activity state.

Every connection and tool call carries the current `sessionId` and
`toolTurnId`. This prevents an old request from changing a newer turn. A new
finalized user turn explicitly resolves any superseded interactive Codex call
with its original `call_id` before the old completion can be ignored.

### Lifecycle invariants

- A stale session cannot mutate the active session.
- A stale tool turn cannot mutate a newer turn.
- A current-activity question is the intentional non-superseding exception;
  its client-owned context cannot cancel the work it reports.
- Codex cancellation resolves the original `call_id`; late completions are
  ignored.
- Standby and wake remain client-owned browser behavior.
- UI activity status is feedback, not authoritative lifecycle state.

### Google Calendar flow

The `get_calendar_events` browser tool sends the requested natural-language
time to `GET /api/calendar/query`. `server.js` first identifies named ranges
such as `today`. For a date-dependent query, it gets the primary Google
Calendar timezone, passes that timezone to `calendar-query.js`, and passes the
same timezone to `calendar.js` for the event lookup. `calendar.js` returns a
simplified event list. `calendar-tool.js` returns that data in the browser's
Calendar tool-result shape, while `tool-result-coordinator.js` coordinates its
AssemblyAI result queue.

### Codex flow

The `ask_codex` browser tool is identified and coordinated by `app.js`.
`codex-tool.js` sends its task to `POST /api/codex` and returns the existing
tool-result shape. `codex-call-tracker.js` retains interactive call tracking
and supersession/cancellation; `app.js` retains session/turn checks and the
decision to supersede a turn; generic queue/task result coordination lives in
`tool-result-coordinator.js`. The server copies its own
project directory into a temporary
filtered inspection workspace, starts `codex exec` there in read-only and
ephemeral modes with a restricted child environment, then returns its stdout
as the tool result. The copy reduces exposure of repository-local secret files;
it is not host-level filesystem isolation. This is intended for a trusted,
local development/demo environment.

## Current frontend/backend boundary

The browser owns user interface, microphone capture, audio playback, optional
disconnected-state speech recognition for voice wake, AssemblyAI WebSocket
communication, browser-only actions, and transcript display.

The backend owns secrets, AssemblyAI token minting, Google OAuth credentials,
Google Calendar access, Codex process execution, server-side validation, and
HTTP APIs. Never move private API keys or Google OAuth credentials into browser
code.

## Target tool layer

This is a target boundary, not a claim that new modules already exist.

| Tool category | Purpose | Example |
| --- | --- | --- |
| Deterministic local/backend tools | Validated, predictable operations | “What files changed?” → Git; “run tests” → configured test runner. |
| MCP adapters | Bounded browser/service capabilities | “Click that result” → browser MCP adapter. |
| Reasoning tools | Analysis where deterministic output is not enough | “Why did this fail?” → Codex. |

### MCP boundary

MCP is an integration mechanism, not Offscreen's safety policy. Future adapters
must expose a bounded capability set rather than a raw catalog, validate inputs,
treat page and MCP output as untrusted, normalize failures, and require
confirmation for consequential actions. MCP does not own the AssemblyAI session
or tool-turn lifecycle.

### Developer workspace boundary

Future developer tools are limited to read-only Git, project-contained paths,
a configured test command, and validated VS Code paths. No arbitrary voice
shell execution. Use Codex for reasoning and diagnosis, not predictable work
such as Git status or a known test command.

### Deployment boundary

The current loopback server, desktop Calendar OAuth, and local Codex CLI cannot
simply be exposed as a public hosted service. `OFFSCREEN_MODE` provides an
application-owned capability boundary: its default `LOCAL` mode keeps the full
developer feature set, while `HOSTED_DEMO` registers only the voice-token route
plus the runtime capability payload and hosted-safe voice tools. In hosted-demo
mode, Calendar, Codex, and browser MCP routes are not registered, and the
browser receives only the safe tool capabilities from a server-generated runtime
payload served with `Cache-Control: no-store`. Missing or malformed browser
runtime capability data falls back to the hosted-safe feature set. This does not
yet add public authentication or change loopback binding.

## Current external integrations

| Integration | Current use | Boundary |
| --- | --- | --- |
| AssemblyAI Voice Agent | Conversation, transcription, reply audio, and tool calls | Browser holds only a temporary token; server holds the API key. |
| Browser speech recognition | Optional disconnected-state “Connect Offscreen” wake phrase | Browser-only feature; may use a browser/vendor online recognition service. |
| Google Calendar API | Read-only Calendar queries | Server-only OAuth and API client. |
| Codex CLI | Read-only local repository inspection | Server starts the local process; browser receives a result. |
| Browser tabs | Opening a small allowlist of websites | Browser-only action; no backend needed. |

## Known architectural problems

These are audit findings, not evidence that every path currently fails.

- `app.js` combines many unrelated jobs, making future changes difficult to
  understand and test.
- Each voice connection has a monotonically increasing session ID. Disconnect
  invalidates that ID before closing the socket and releasing microphone/audio
  resources, so callbacks from an older connection are ignored.
- Each tool call captures its originating `sessionId` and `toolTurnId`.
  Ordinary non-empty finalized user transcripts start a new tool generation.
  A small exact set of current-activity questions is the deliberate exception:
  those questions use client-owned running-work context and do not supersede the
  work they ask about. Late Calendar or Codex completions from an older turn are
  ignored instead of altering a newer turn's queue, counters, tool results, or
  status display. Before an ordinary turn change, a superseded interactive
  Codex call is explicitly resolved with its original `call_id`.
- The Codex route now limits each local process to 40 seconds, below the
  voice tool's 45-second timeout. It also limits task and captured-output size
  and uses one response guard so timeout, process error, and close events do
  not send competing HTTP responses.
- Calendar parsing is isolated and covered by Node tests, including fixed
  timezone-boundary cases. Real Google Calendar access still needs manual
  integration verification.
- Multiple Calendar endpoints exist, but only the query endpoint has a
  current in-repository browser caller.
- The Node test suite covers Calendar parsing and tool execution plus session,
  wake, standby, disconnect, repeat/summarize, current-activity, Codex-call,
  and tool-result lifecycle behavior. Real integrations still need manual
  verification.
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
  index.html                      existing static markup
  styles.css                      existing page styles
  app.js                          existing browser orchestration entry point
  voice-session.js                proposed AssemblyAI session lifecycle
  audio.js                        existing microphone and playback logic
  tools.js                        existing static AssemblyAI tool definitions
  ui.js                           existing transcript / status rendering
  pcm-processor.js                existing AudioWorklet
  website-tool.js                 existing supported website execution
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
| `voice-session.js` | Own AssemblyAI token fetching, WebSocket connection lifecycle, and raw message transport. |
| `audio.js` | Capture microphone audio, encode PCM for delivery, schedule playback, stop, and clean up audio. |
| `tools.js` | Export static AssemblyAI tool definitions. |
| `ui.js` | Update status and transcript DOM elements. |
| `styles.css` | Hold the page styles. |

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
