# Developing Offscreen

This guide explains how to run and maintain the current Offscreen prototype.
It describes what exists today. Proposed module names in the architecture
document do not exist yet.

## Prerequisites

- Node.js 18 or newer (the project declares this minimum version).
- npm.
- An AssemblyAI account and API key for Voice Agent access.
- A Google Cloud project with Google Calendar API access for Calendar queries.
- Local Google OAuth client credentials for the Calendar integration.
- The Codex CLI installed and available on your `PATH` if you want to use the
  voice-driven Codex tool.
- A modern browser with microphone permission available.

## Installation

From the repository root:

```bash
npm install
```

This installs the dependencies already declared by the project. Do not add a
package merely to follow this guide.

## Environment setup

1. Copy the example environment file:

   ```bash
   cp .env.example .env
   ```

2. Set `ASSEMBLYAI_API_KEY` in `.env` to your own AssemblyAI key.
3. Do not paste the key into source code, browser developer tools, screenshots,
   chat messages, or commits.
4. Keep Google OAuth client credentials in a local `credentials.json` at the
   repository root. The current Calendar code looks for that exact local file.

`.env`, `credentials.json`, and `token.json` must remain untracked. Check with
`git status` before committing.

## Google Calendar OAuth setup (high level)

1. Create or select a Google Cloud project you control.
2. Enable the Google Calendar API for that project.
3. Create OAuth client credentials suitable for a local desktop application.
4. Download the credential file and save it locally as `credentials.json` in
   the repository root.
5. Start Offscreen and make a Calendar request. The local OAuth flow should
   open a browser for Google authorization.
6. Grant only the requested read-only Calendar permission.

Do not commit the credential file. Do not change OAuth scopes or add write
access casually; those are security-sensitive product changes.

## Start Offscreen

Run:

```bash
npm start
```

The current start command runs `node server.js`. The server binds only to
`127.0.0.1`; by default it reports `http://127.0.0.1:3000`. Open that URL in a
browser, choose a voice/prompt if desired, then select **Connect** and grant
microphone access.

## Tests

Run the automated test suite with:

```bash
npm test
```

The project uses Node's built-in test runner; no test framework dependency was
added. The current suite is in `test/calendar-query.test.js` and covers
deterministic Calendar-query behavior only. It does not contact AssemblyAI,
Google Calendar, a microphone, or Codex.

Continue to manually verify integrations when a change affects microphone,
AssemblyAI, Google Calendar, or Codex behavior.

## Current application flow

1. The browser requests a temporary AssemblyAI token from the local server.
2. The server uses its secret AssemblyAI API key to mint the temporary token.
3. The browser opens an AssemblyAI Voice Agent WebSocket using that token.
4. Once the session is ready, the browser sends the selected voice, greeting,
   system prompt, and tool definitions.
5. The browser captures microphone audio, converts it to PCM through
   `pcm-processor.js`, base64-encodes the frames, and sends them to AssemblyAI.
6. AssemblyAI sends user transcripts, agent reply audio, agent transcripts,
   and sometimes tool calls.
7. The browser displays transcripts and schedules agent PCM audio for playback.

## How a voice request travels through the system

For a regular question, speech travels from microphone to browser to AssemblyAI
and a spoken reply travels back the same way in reverse.

For an action, AssemblyAI sends a `tool.call` event. The browser selects the
matching implementation:

- `open_website` opens one of the allowlisted URLs in a new browser tab.
- `get_calendar_events` calls the local Calendar query route, which calls
  Google Calendar with server-side OAuth.
- `ask_codex` calls the local Codex route, which starts the local read-only
  Codex CLI.

The browser packages the outcome as a `tool.result` message for AssemblyAI.
AssemblyAI then uses that result to speak its answer.

## How AssemblyAI tools work

The current browser sends tool definitions as part of its WebSocket
`session.update` message. A definition gives AssemblyAI a tool name,
description, parameter shape, and timeout. When the model decides a tool is
needed, it sends the browser a `tool.call` event with a call ID and arguments.

The browser must return a result using the same `call_id`. Calendar currently
uses `execution_mode: "hold"`; `ask_codex` uses `execution_mode:
"interactive"`. A successful result and a failed result should both be
explicit; never pretend an external action succeeded when it did not.

Each operation also belongs to the active `sessionId` and `toolTurnId`. On a
new finalized user turn, the browser resolves an earlier interactive Codex
call as cancelled with that call's original `call_id`; completions that arrive
after their session or turn becomes stale are ignored.

## Adding a browser-side tool

Static AssemblyAI tool definitions live in `public/tools.js`. Supported website
execution lives in `public/website-tool.js`, and Calendar HTTP execution lives
in `public/calendar-tool.js`. `public/app.js` continues to receive tool calls,
coordinate their results, identify Calendar calls, and execute the Codex branch.

When adding a tool:

1. Add its static definition to `public/tools.js`.
2. Decide whether the action is truly browser-only.
3. Put browser-only action logic in a focused module, and keep the matching
   `handleToolCall` branch in `public/app.js` responsible for passing its
   result to `addToolResult`.
4. Validate tool arguments before acting.
5. Return an explicit success or failure result with the incoming `call_id`.
6. Preserve session/turn isolation. If the tool is interactive and can be
   superseded, define how its original `call_id` is resolved.
7. Update the system prompt only when routing instructions are required.
8. Manually verify success, invalid input, and failure behavior.

Keep the browser allowlist explicit. Do not turn a spoken site name into an
arbitrary URL without a deliberate security design.

## Adding a backend integration

Use the backend when an action needs secrets, OAuth, server-side validation, or
an external private API.

1. Write down the user value and the required permission/scope first.
2. Keep credentials in the server environment or local ignored files.
3. Add focused integration logic rather than mixing unrelated service code into
   an existing function.
4. Add a small validated HTTP route in `server.js` under the **current**
   architecture. Future route modules are proposed only.
5. Add or extend the browser tool so it calls that route and returns a safe
   normalized tool result.
6. Test input validation, successful behavior, external failure behavior, and
   the full voice tool flow.

Before adding Calendar write access, Gmail access, new OAuth scopes, or another
security-sensitive integration, stop and get explicit approval.

## Debugging guide

### Transcription problems

- Confirm microphone permission is granted in the browser.
- Confirm the status reaches **Connected** before speaking.
- Open browser developer tools and inspect console messages for WebSocket or
  microphone errors.
- Verify `pcm-processor.js` loads successfully and that microphone frames are
  being sent only while the WebSocket is open.
- Check that the browser and agent both use the expected 24 kHz PCM format.

### Missing `tool.call`

- Read the system prompt currently selected in the UI; it tells the agent when
  Calendar and Codex tools are mandatory.
- Check that the tool definitions were included in `session.update`.
- Look for the logged session-ready/session-updated tool configuration in the
  browser console.
- Try a direct, unambiguous request such as “What do I have today?” or “Ask
  Codex which file handles Calendar?”

### Failed backend requests

- Use the browser Network panel to inspect the local `/api/...` request status
  and response body.
- Check the server terminal for `Calendar error`, `Calendar query error`, or
  `Codex process error` messages.
- For Calendar, verify local `credentials.json`, OAuth authorization, API
  enablement, and read-only Calendar access.
- For Codex, verify the `codex` command is installed and available to the
  server process.

### Failed tool results

- Look for `TOOL CALLED`, Calendar, Codex, and `Sending tool results` messages
  in the browser console.
- Confirm the tool handler places a result with the original `call_id` into the
  pending result queue.
- Each non-empty finalized user transcript starts a new tool turn and
  invalidates asynchronous tool work from the previous turn.
- A Calendar or Codex task that finishes after its tool turn becomes stale is
  ignored instead of changing the newer turn's queue, counters, status, or
  tool results.
- A result that finishes after its voice session disconnects is also ignored.
  After reconnecting, retry the request in the new session.

### WebSocket problems

- First check that `/api/voice-token` succeeds; token failure prevents the
  WebSocket from opening.
- Check browser console logs for `WebSocket error`, `WebSocket closed`, and
  `session.error` messages.
- Confirm the temporary token, network connection, and AssemblyAI service are
  available.
- Disconnect before attempting another connection. The current lifecycle
  invalidates the old session and closes connecting or open sockets before a
  new connection becomes active.

### Slow Codex requests

- The server stops a Codex process after 40 seconds, before the voice tool's
  45-second timeout. The browser receives the short error `Codex request timed
  out` rather than a partial answer.
- Keep requested Codex tasks focused and ask it to inspect only the files
  needed for the answer.
- Check the server terminal for the task-size log, timeout message, process
  error, output-limit message, or exit code.
- Process failures return a short browser-safe message. Inspect server
  diagnostics for the cause; raw Codex stderr is not sent to the browser.

## Useful checkpoints

Browser console checkpoints currently include:

- AssemblyAI events other than reply-audio frames;
- session-ready and session-updated tool configuration;
- WebSocket errors and close codes;
- tool invocation and Calendar/Codex result logs;
- pending tool-result sends.

Server terminal checkpoints currently include:

- missing AssemblyAI configuration at startup;
- AssemblyAI token-mint failures;
- Calendar route failures;
- Codex process start/exit failures.

Treat console logs as development diagnostics. Never add logs that print API
keys, OAuth credentials, bearer tokens, or other secret values.

## Files that must never be committed

- `.env`
- `credentials.json`
- `token.json`
- private key files such as `.pem` or `.key`
- exported credentials, downloaded secrets, or copied API tokens
- `node_modules/`

Before every commit, run `git status` and inspect the staged diff.

## Normal development workflow

1. **Inspect.** Read the relevant files and check `git status`.
2. **Plan.** State the small behavior change and the behavior that must remain
   unchanged.
3. **Change one logical thing.** Avoid combining a refactor, feature, and
   dependency update.
4. **Test.** Run relevant automated tests when they exist; manually verify
   integrations that touch microphone, AssemblyAI, Calendar, or Codex.
5. **Review the diff.** Check for accidental source changes, secrets, dead
   code, and unclear names.
6. **Commit.** Use a focused, descriptive commit message after verification.

If a change would alter OAuth scopes, add external write access, migrate the
framework, or substantially redesign the voice architecture, stop and obtain
explicit approval first.
