# Offscreen

Offscreen is a voice-first computer companion designed to help users complete
routine computer tasks with less screen and keyboard interaction. It was built
for the AssemblyAI Voice Agent Hackathon.

Rather than providing arbitrary computer control, Offscreen combines voice
conversation with a small set of deliberate, bounded actions: opening a
supported website, checking a read-only Google Calendar, and asking a local
Codex CLI to inspect the current project.

## Current features

- Voice conversation through the AssemblyAI Voice Agent API.
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
  `toolTurnId`. When a newer user turn supersedes an interactive Codex call,
  the browser explicitly resolves the original `call_id` as cancelled.

Opening Gmail only opens the Gmail website. Offscreen does not read email.

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

## Planned direction

The current demo is intentionally bounded. Planned work, including voice
controls, developer workspace actions, personal productivity integrations, and
search tools, is listed in [ROADMAP.md](ROADMAP.md). None of those planned
features are implemented unless they appear under **Current features** above.

`public/index.html` contains the page markup, `public/styles.css` contains the
page styles, and `public/ui.js` contains DOM lookup and UI rendering.
`public/audio.js` owns microphone capture and PCM playback, and
`public/tools.js` exports the static AssemblyAI tool definitions.
`public/website-tool.js` owns supported website opening, and
`public/calendar-tool.js` owns Calendar HTTP execution. `public/codex-tool.js`
owns Codex HTTP execution. `public/app.js` coordinates AssemblyAI sessions,
tool turns, and tool results, including Codex interactive-call tracking,
supersession/cancellation, and session/turn checks.
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

- Node.js 18 or newer and npm
- An AssemblyAI API key
- A Google Cloud project with the Google Calendar API enabled
- Google OAuth desktop-client credentials
- Codex CLI installed and authenticated if using the Codex voice tool
- A modern browser with microphone permission available

### Install and configure

```bash
npm install
cp .env.example .env
```

Set your AssemblyAI key in `.env`:

```text
ASSEMBLYAI_API_KEY=your_key_here
```

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
- Calendar results and Codex tool results flow through the AssemblyAI voice
  session so the agent can produce its response.
- AssemblyAI API keys and Google OAuth credentials stay on the local server;
  the browser receives only a temporary AssemblyAI token.

## Testing

```bash
npm test
```

The suite uses Node's built-in test runner and currently has 11 deterministic
Calendar parsing and timezone tests. It does not replace manual verification
of microphone, AssemblyAI, Google OAuth, Calendar, or Codex integrations.

## Current limitations

- No email-reading integration; Gmail can only be opened.
- No arbitrary website opening or general browser automation.
- No Calendar write access.
- Codex is local and read-only.
- Google Calendar requires local OAuth setup.
- Browser popup settings can prevent a supported website from opening in a new
  tab.

## Demo focus

Offscreen is intentionally scoped for a dependable hackathon demo: speak to
the agent, open a supported destination, check a real Calendar, and ask Codex
about the local project without relying on broad computer automation.
