# Offscreen

Offscreen is an eyes-free voice companion for real computer work, built for the
AssemblyAI Voice Agent Hackathon. Most voice assistants answer questions;
Offscreen is designed to get bounded work done with minimal screen and keyboard
attention.

Rather than providing arbitrary computer control, Offscreen combines voice
conversation with a small set of deliberate, bounded actions: opening a
supported website, checking a read-only Google Calendar, and asking a local
Codex CLI to inspect the current project.

## Current features

- Voice conversation through the AssemblyAI Voice Agent API.
- Optional Wake Phrase while disconnected: explicitly enable **Wake Phrase** in
  the UI, then say “Connect Offscreen” to start the normal AssemblyAI session.
  The browser wake listener stops while Offscreen is connecting or connected
  and starts again after disconnect while the option remains enabled.
- Natural voice interruption: Voice Agent input uses `interrupt_response: true`,
  so when a user begins a real interruption while Offscreen is speaking,
  AssemblyAI marks the reply interrupted and Offscreen flushes queued browser
  audio. Users can naturally say things such as “wait” or “stop”; this is
  barge-in, not a dedicated Offscreen tool, and needs no second acknowledgement.
- Explicit voice disconnect: ask Offscreen to end or disconnect the current
  session.
- Explicit voice cancellation: ask Offscreen to cancel the current in-progress
  tool work. This keeps the voice session connected.
- Voice-first standby: ask Offscreen to pause listening or go on standby while
  the voice session remains connected. Offscreen releases the AssemblyAI
  microphone path while paused and uses a narrow browser listener only for
  “Resume listening” or “Disconnect”. The client also gates the final PCM send
  boundary while standby is active, so background speech never becomes a Voice
  Agent turn even if the browser delivers late audio frames. Brief descending
  and ascending earcons confirm pause and resume without requiring visual
  feedback. For a voice-triggered pause, microphone ownership transfers to the
  local standby recognizer only after the AssemblyAI reply containing the pause
  tool call has finished, preventing the recognizer from hearing the tail of the
  user's own pause utterance. Model-generated standby acknowledgements remain
  suppressed. The stateful **Pause Listening** / **Resume Listening** UI control
  uses the same standby state. Wake Phrase remains disconnected-only
  and never resumes a paused connected session.
- Explicit voice repeat: ask Offscreen to repeat its most recent completed
  response.
- Explicit voice summarize/shorten: ask Offscreen to summarize or shorten its
  most recent completed response.
- Current-activity reporting: while Calendar or Codex work is running, ask what
  Offscreen is doing or working on. The status question does not supersede the
  in-progress work; ordinary new requests still do.
- Open one website from a fixed allowlist: GitHub, YouTube, AssemblyAI docs,
  Gmail, or Google Calendar.
- Read-only Google Calendar queries for today, tomorrow, supported ranges,
  natural-language dates, and spoken ordinals. Date interpretation uses the
  primary Calendar timezone.
- Local Codex project inspection through the Codex CLI in a read-only sandbox.
  It returns concise repository and code analysis; it does not modify the
  project.
- Calendar uses the Voice Agent tool setting `execution_mode: "hold"`; Codex
  inspection uses `execution_mode: "interactive"`.
- Voice session and tool results are isolated with `sessionId` and
  `toolTurnId`. When a newer user turn or an explicit cancellation supersedes
  an interactive Codex call, the browser explicitly resolves the original
  `call_id` as cancelled.

Opening Gmail only opens the Gmail website. Offscreen does not read email.

## Product direction

Offscreen is building toward safe, stateful voice control: bounded browser
automation through MCP, deterministic developer-workspace tools, and contextual
follow-ups. Browser MCP and developer tools are planned, not implemented.
See [PRODUCT_STRATEGY.md](PRODUCT_STRATEGY.md) and [ROADMAP.md](ROADMAP.md).

## How it works

1. The browser requests a short-lived AssemblyAI token from the local Express
   server and connects to the Voice Agent service.
2. The browser captures microphone audio, sends PCM audio to AssemblyAI, and
   plays the returned agent audio.
3. When the agent chooses a supported tool, the browser either opens an
   allowlisted site or calls a local API for Calendar or Codex work.
4. Calendar requests use server-side Google OAuth. Codex requests run the
   local Codex CLI with a read-only sandbox. Each result is returned through
   the voice session so the agent can respond.

## Architecture

AssemblyAI interprets voice; Offscreen owns session state and safety; tools
perform bounded actions. The browser owns audio, UI, wake listening, and the
voice WebSocket. The local server owns secrets, Calendar OAuth, token minting,
and local Codex execution. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

`public/index.html` contains the page markup, `public/styles.css` contains the
page styles, and `public/ui.js` contains DOM lookup and UI rendering.
`public/audio.js` owns microphone capture and PCM playback, and
`public/tools.js` exports the static AssemblyAI tool definitions.
`public/website-tool.js` owns supported website opening, and
`public/calendar-tool.js` owns Calendar HTTP execution. `public/codex-tool.js`
owns Codex HTTP execution. `public/tool-result-coordinator.js` owns generic
tool-result queue, task, reply-done, and flush coordination. `public/app.js`
keeps AssemblyAI application-event semantics, active session IDs, tool turns,
session/turn checks, and the decision to supersede an earlier turn.
`public/voice-session.js` owns temporary-token fetching, AssemblyAI WebSocket
connection lifecycle, and raw message transport. `public/codex-call-tracker.js` owns
Codex interactive-call tracking and explicit supersession/cancellation.
`public/wake-listener.js` owns the optional disconnected-state browser speech
recognition and exact wake-phrase matching; it does not use the AssemblyAI
session.
The frontend will continue to be separated incrementally while preserving the
working voice flow.

## Tech stack

- Node.js and Express
- AssemblyAI Voice Agent API
- Google Calendar API with desktop OAuth
- Codex CLI
- Plain browser JavaScript and an AudioWorklet for PCM microphone processing

## Setup

### Requirements

- Node.js 20 or newer and npm
- An AssemblyAI API key
- A Google Cloud project with the Google Calendar API enabled
- Google OAuth desktop-client credentials
- Codex CLI installed and authenticated if using the Codex voice tool
- A modern browser with microphone permission available
- A browser exposing `SpeechRecognition` or `webkitSpeechRecognition` if using
  optional voice wake

### Install and configure

```bash
npm install
cp .env.example .env
```

Set your AssemblyAI key in `.env`:

```text
ASSEMBLYAI_API_KEY=your_key_here
```

### Capability mode

Offscreen defaults to `LOCAL` mode, which keeps the complete local developer
feature set. Set `OFFSCREEN_MODE=HOSTED_DEMO` only for the hosted-safe demo
surface: it keeps voice interaction and allowlisted website opening, while
removing Calendar, local Codex inspection, and controlled-browser tools and
their API routes. Any other non-empty value prevents startup rather than
silently enabling local capabilities. This is capability separation only;
token access protection is a later deployment increment.

Save your Google OAuth desktop-client credential file as
`credentials.json` in the repository root. Keep local OAuth token state,
including `token.json` if your OAuth tooling creates it, out of version
control.

## Run locally

```bash
npm start
```

The server intentionally binds only to IPv4 loopback. Open
[http://127.0.0.1:3000](http://127.0.0.1:3000), choose settings if desired,
select **Connect**, and allow microphone access. You can use another port with:

```bash
PORT=3100 npm start
```

## Google Calendar setup

1. Create or select a Google Cloud project you control.
2. Enable the Google Calendar API.
3. Create OAuth credentials for a local desktop application.
4. Download them as `credentials.json` in the repository root.
5. Start Offscreen and make a Calendar request. Complete the browser OAuth
   flow if prompted, granting only the requested read-only Calendar scope.

Calendar access is read-only; Offscreen does not create, edit, or delete
events.

## Codex CLI

The `ask_codex` voice tool requires the `codex` command to be installed and
authenticated in the environment that starts Offscreen. The server runs Codex
locally with a read-only sandbox and a bounded timeout/output size. It is for
local project inspection, not project modification.

## Privacy and security

- `.env`, `credentials.json`, `token.json`, and private keys must never be
  committed.
- The Express server binds to `127.0.0.1`, so the local APIs, including the
  unauthenticated Codex endpoint, are not exposed to other devices on the
  local network.
- Microphone audio is sent to AssemblyAI for voice-agent processing.
- Voice wake is separate from AssemblyAI. When the user explicitly enables it
  while disconnected, browser speech recognition listens for “Connect
  Offscreen.” Depending on the browser, that recognition may process microphone
  audio using an online browser/vendor service. The UI states when wake
  listening is active.
- Calendar results and Codex tool results flow through the AssemblyAI voice
  session so the agent can produce its response.
- AssemblyAI API keys and Google OAuth credentials stay on the local server;
  the browser receives only a temporary AssemblyAI token.

## Testing

```bash
npm test
```

The suite uses Node's built-in test runner and covers deterministic Calendar,
tool, session, standby, repeat/summarize, current-activity, and voice-wake behavior. It does not
replace manual verification of microphone, browser speech recognition,
AssemblyAI, Google OAuth, Calendar, or Codex integrations.

## Current limitations

- No email-reading integration; Gmail can only be opened.
- Browser MCP and general browser automation are planned, not implemented.
- Deterministic developer workspace tools support Git status, bounded project
  search/read, the configured test suite, and validated project-file opening in
  VS Code; they do not provide arbitrary command execution.
- No Calendar write access.
- Codex is local and read-only.
- Google Calendar requires local OAuth setup.
- Public hosting is not implemented; the server is intentionally loopback-only.
- Browser popup settings can prevent a supported website from opening in a new
  tab.
- Voice wake depends on browser speech-recognition support and may require an
  online recognition service; unsupported browsers show the control as
  unavailable.

## Demo focus

Offscreen is intentionally scoped for a dependable hackathon demo: speak to
the agent, optionally reconnect hands-free with “Connect Offscreen,” open a
supported destination, check a real Calendar, and ask Codex about the local
project without relying on broad computer automation.
