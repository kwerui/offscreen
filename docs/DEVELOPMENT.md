# Developing Offscreen

This guide explains how to run and maintain the current Offscreen prototype.
It describes what exists today. Proposed module names in the architecture
document do not exist yet.

## Prerequisites

- Node.js 20 or newer (the Playwright MCP dependency requires this minimum).
- npm.
- An AssemblyAI account and API key for Voice Agent access.
- A Google Cloud project with Google Calendar API access for Calendar queries.
- Local Google OAuth client credentials for the Calendar integration.
- The Codex CLI installed and available on your `PATH` if you want to use the
  voice-driven Codex tool.
- The VS Code `code` CLI available on your `PATH` if you want to open validated
  project files by voice. Offscreen invokes only this fixed CLI with one
  configured-project text file; it never runs spoken commands.
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
3. Leave `OFFSCREEN_MODE` unset or set it to `LOCAL` for complete local
   development. Set it to the exact value `HOSTED_DEMO` only to exercise the
   restricted hosted-demo capability surface.
4. Do not paste the key into source code, browser developer tools, screenshots,
   chat messages, or commits.
5. Keep Google OAuth client credentials in a local `credentials.json` at the
   repository root. The current Calendar code looks for that exact local file.

`.env`, `credentials.json`, and `token.json` must remain untracked. Check with
`git status` before committing.

For local Codex inspection, untracked status is not a security boundary.
Offscreen gives the Codex child a small runtime environment allowlist, so
application secrets loaded by the server are not inherited. It also creates a
temporary filtered copy of the project directory containing normal source
files. The copy excludes `.env` files, `credentials.json`, `token.json`, common
private-key files, symlinks, `.git`, `node_modules`, and archives.

These controls have different limits. The filtered copy reduces accidental
exposure of repository-local secret files, but Codex read-only mode prevents
writes; it is not a guarantee that Codex can read only its working directory or
that it cannot read other host files available to the process. Codex needs its
own authentication location: on this platform that normally comes from `HOME`
or a configured `CODEX_HOME`. Prefer the OS keyring for Codex authentication
when available. Do not copy Codex authentication files into the inspection
workspace or place application secrets in Codex-related environment variables.

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
added. The suite covers Calendar parsing and tool execution plus voice session,
wake, standby, disconnect, repeat/summarize, current-activity, Codex-call, and
tool-result and session-activity receipt lifecycle behavior. It does not contact AssemblyAI, Google Calendar,
a microphone, browser speech recognition, or Codex.

Continue to manually verify integrations when a change affects microphone,
AssemblyAI, Google Calendar, or Codex behavior.

## Current application flow

1. `voice-session.js` requests a temporary AssemblyAI token from the local server.
2. The server uses its secret AssemblyAI API key to mint the temporary token.
3. `voice-session.js` opens and owns the AssemblyAI Voice Agent WebSocket using that token.
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
- `browser_navigate`, `browser_read_page`, `browser_find_on_page`,
  `browser_go_back`, `browser_click`, and `browser_type` call the local browser
  route. Its backend adapter owns a lazy, reused Playwright MCP connection and
  exposes only those six actions. A consequential `browser_click` stores its
  exact observed target without clicking; `browser_confirm_action` can execute
  only that stored action after a later explicit affirmative user turn.

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
execution lives in `public/website-tool.js`, Calendar HTTP execution lives in
`public/calendar-tool.js`, and Codex HTTP execution lives in
`public/codex-tool.js`.

`public/app.js` continues to receive raw events and dispatch tool execution. It
owns active session IDs, session/turn protection, and deciding when a new user
turn supersedes an earlier one. `public/voice-session.js` owns only the
AssemblyAI connection lifecycle and raw transport. `public/codex-call-tracker.js` owns Codex interactive-call tracking and
explicit supersession/cancellation. `public/tool-result-coordinator.js`
coordinates the generic pending-result queue, active tasks, reply-done state,
and result flushing.

`public/session-activity-ledger.js` stores up to 25 safe, completed action
receipts for the active browser session. The `get_session_activity` tool reads
only this ledger with `filter: "all" | "failed"` and a 1–10 limit. Do not put
raw source content, patches, prompts, transcripts, secrets, or absolute paths
in a receipt. A stale result never reaches the coordinator and therefore never
creates a receipt; the existing interactive trackers record their explicitly
sent cancellations. Pause/resume keeps receipts. Disconnect and a new voice
session clear them.

When adding a tool:

1. Add its static definition to `public/tools.js`.
2. Decide whether the action is truly browser-only.
3. Put browser-only action logic in a focused module, and keep the matching
   `handleToolCall` branch in `public/app.js` responsible for passing its
   result to the tool-result coordinator.
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

## Adding an MCP capability

MCP is an integration mechanism, not permission to expose an entire server's
tool catalog to AssemblyAI.

### First browser MCP increment

The Playwright MCP integration runs the locally installed `@playwright/mcp`
server lazily in a headless, isolated context. It permits only explicit
http/https navigation, page accessibility snapshots, literal text finding,
browser history back, and click/type on refs observed in the latest snapshot or
find output. Typing never submits. Consequential clicks create one short-lived
pending action. Button-like controls require confirmation unless their observed
label is in the small low-risk allowlist. The original request is never
confirmation, a negative cancels it, and the dedicated no-argument confirmation
tool consumes the exact stored action once. It
does not permit forms, arbitrary evaluation, downloads, uploads, or arbitrary
MCP forwarding.

Install Playwright's managed Chromium before a live browser run:

```bash
npx playwright install chromium
```

Treat page and MCP output as untrusted text. For live verification, test a
valid navigation, a rejected `file:` URL, a snapshot, text finding, back
navigation, an MCP startup failure, and a late result after disconnect or turn
supersession.

These tools use `execution_mode: "hold"`. A superseded turn or disconnected
session ignores its late browser result through the existing session/turn
guards; this first increment does not terminate an already-running Playwright
MCP operation when the user cancels work.

1. Write a focused feature specification and choose one user-visible,
   bounded capability.
2. Implement an Offscreen adapter that validates inputs and normalizes both
   success and failure results.
3. Treat page and MCP output as untrusted data; do not let it choose arbitrary
   shell, browser, or computer actions.
4. Define the action's session/turn ownership, cancellation, supersession,
   stale-completion behavior, and activity description.
5. Require confirmation immediately before send, submit, delete, purchase,
   publish, or another consequential action.
6. Verify normal, invalid-input, failure, cancellation, stale-result, and
   confirmation paths before expanding the capability.

## Adding a developer tool

Prefer deterministic tools for deterministic work. Limit a tool to read-only
Git, project-contained file paths, the configured project test command, or
validated VS Code paths. Never turn speech into an arbitrary shell command.
Use Codex for reasoning such as test-failure diagnosis, not for predictable
actions such as Git status, bounded current Git diff inspection, or running
known tests. Git status, current Git diff, and recent commit history are
distinct: status reports the working tree, `get_git_diff` reports current
staged/unstaged content, and `get_git_history` lists only the five most recent
commits. Commit diffs are LOCAL-only and can inspect only an opaque reference
created by that latest history response; never accept a spoken hash, revspec,
branch, tag, range, or Git flag. The fixed Git adapter uses `git log` for
history and `git show` for one validated immutable commit, with bounded files
and hunk excerpts. Root commits work; merge detail is deliberately unsupported.
Opening a changed file opens its current working-tree version, not a historical
snapshot. Current Git diff inspection is LOCAL-only and fixed to the configured
project root: it supports only current staged/unstaged changes and an optional
validated project-relative path, reports untracked paths without reading them,
and never accepts revisions, arbitrary flags, shell input, or mutating Git
operations.

## MCP safety and lifecycle verification

Automated checks do not replace real AssemblyAI, microphone, Calendar, Codex,
or MCP verification. For lifecycle-affecting work, manually test a successful
call, failure, user cancellation, turn supersession, disconnect/reconnect, and
the non-superseding current-activity question. Confirm that a late result cannot
alter the active session, active turn, queue, UI state, or reply.

## Agent workflow

Read `PRODUCT_STRATEGY.md`, `ROADMAP.md`, and the architecture/conventions docs
before changes. Make one requested change at a time; retain protected voice
lifecycle behavior; run relevant tests (full `npm test` after non-trivial work),
`git diff --check`, and review the actual diff. Current local Codex execution
uses a filtered project copy and read-only mode, but it is **not** host-level
isolation. `offscreen.zip` is a tracked legacy artifact-cleanup task, never a
source of truth.

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
