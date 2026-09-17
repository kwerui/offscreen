# Offscreen Roadmap

This roadmap is intentionally small and ordered for a hackathon project. It
separates work that makes today's demo dependable from larger improvements that
can wait. A phase should be completed and verified before starting a dependent
phase.

## Priorities

- **NOW** — needed to safely maintain or demonstrate existing behavior.
- **BEFORE SUBMISSION** — important for a trustworthy final demo, but can
  follow the NOW work.
- **LATER** — useful after the hackathon; do not let it displace reliability.

## Phase 0 — Current working baseline

**Priority: NOW. No dependency.**

Document and preserve the functionality already present:

- A browser UI connects to AssemblyAI Voice Agent through a temporary token
  minted by the local Express server.
- Microphone audio is converted to 24 kHz PCM and sent over the Voice Agent
  WebSocket; agent PCM audio is played in the browser.
- Natural voice interruption (barge-in) uses Voice Agent input
  `interrupt_response: true`: when a user begins a real interruption while
  Offscreen is speaking, AssemblyAI marks the reply interrupted and Offscreen
  flushes queued browser audio. Users can say things such as “wait” or “stop”;
  this is not a dedicated Offscreen tool and needs no second acknowledgement.
- The agent can open a small allowlisted set of websites in the browser.
- The agent can query a read-only Google Calendar for named ranges and
  natural-language dates.
- The agent can ask a locally installed Codex CLI to inspect the local project
  in read-only mode.
- The browser displays connection status and user/agent transcripts.
- The browser shows activity/status feedback during long-running tool calls,
  such as while Codex is inspecting the project.
- The agent can end the active voice session when the user explicitly asks to
  disconnect.
- The agent can cancel current in-progress tool work when the user explicitly
  asks, while keeping the voice session connected.
- The agent can repeat its most recent completed spoken response when the user
  explicitly asks.
- The agent can summarize or shorten its most recent completed spoken response
  when the user explicitly asks.

Before refactoring, manually verify the exact demo flows that must remain
unchanged: connect, speak, hear a reply, open a supported site, query Calendar,
ask Codex, and disconnect.

## Phase 1 — Engineering foundation

**Priority: NOW. Depends on Phase 0 being documented and manually checked.**

1. Complete the beginner-facing documentation in this repository:
   architecture, conventions, development setup, and this roadmap.
2. Establish a lightweight automated test baseline using the platform's
   built-in capabilities; do not add a test dependency merely for convenience.
3. Keep the test baseline focused on deterministic behavior. The obsolete
   `calendar-test.js` helper has been replaced by
   `test/calendar-query.test.js`, which protects the current query parser.
4. Define release/archive hygiene: `offscreen.zip` is a release artifact, not
   an independent source of truth. Generate it from the exact release commit
   and compare its contents before submission.

Exit criteria: a documented test command exists, deterministic behavior has
tests, the obsolete helper has a deliberate disposition, and the release ZIP
process is written down.

## Phase 2 — Reliability

**Priority: NOW. Depends on Phase 1 tests for any extracted deterministic
logic.**

**Status: Complete.** Voice connection lifecycle protection, stale-session
protection, tool-result isolation across finalized user turns, and bounded
Codex timeout/output handling are implemented.

Improve the existing browser session without changing its product behavior:

- Make connection lifecycle and teardown reliable for token failures,
  microphone denial, worklet failures, connecting sockets, open sockets, and
  reconnects.
- Add stale-session protection so callbacks from an old WebSocket cannot alter
  a newer connection.
- Isolate asynchronous tool results by voice session/turn so a late Calendar
  or Codex response is not sent through the wrong session.
- Align the Codex server timeout with the voice tool timeout, bound process
  lifecycle, and ensure an HTTP request receives at most one response.
- Improve error handling and useful diagnostics without logging secrets or
  full private task content by default.

Exit criteria: connect/disconnect/reconnect and interrupted tool calls have
manual regression checks, and the new deterministic state behavior is tested
where practical.

## Phase 3 — Calendar cleanup

**Priority: BEFORE SUBMISSION. Depends on Phase 1.**

**Status: Complete.** Calendar timezone correctness and the focused Calendar
cleanup are implemented, including deterministic parsing tests for supported
ranges, natural-language dates, ordinals, and timezone-sensitive cases.

- Extend the existing deterministic `calendar-query.js` tests as Calendar
  behavior changes; do not move parsing back into an Express route.
- Make browser, server parsing, and Google Calendar timezone handling
  consistent for dates such as “Friday” and “the 28th.”
- Remove duplicated Google Calendar client, timezone, and event-formatting
  logic in `calendar.js` through a few focused helpers.
- Add tests for supported ranges, bare ordinal dates, named dates, invalid
  input, and timezone-sensitive cases.

Do not change OAuth scopes or add Calendar write access in this phase.

## Phase 4 — Backend boundaries

**Priority: BEFORE SUBMISSION if needed for reliability; otherwise LATER.
Depends on Phases 2 and 3.**

- Decide and document ownership of the three current Calendar routes. Keep
  only routes that have a real caller or a documented developer API purpose.
- Move the Codex child-process details into a proposed focused runner module,
  leaving the route responsible for HTTP validation and responses.
- Make API ownership clear: routes validate HTTP input; integration modules
  call external services; deterministic modules parse and format data.
- Tighten input validation and return short, safe user-facing failures.
- Document and enforce the local-only security assumptions of Codex access.

This is a boundary cleanup, not a new backend framework or authentication
redesign.

## Phase 5 — Frontend readability

**Priority: BEFORE SUBMISSION only if Phases 1–4 are stable; otherwise LATER.
Depends on Phase 2.**

The structural frontend refactor is complete. `public/app.js` intentionally
remains the application orchestrator. Transport, audio, UI, tool
implementations, generic result coordination, and Codex-call tracking already
live in focused modules. No further extraction is currently planned unless a
future feature creates a clear independent responsibility.

## Phase 6 — Planned product work

**Priority: BEFORE SUBMISSION only after Phases 1–3 are stable; otherwise LATER.
Depends on a reliable baseline.**

These are proposals, not current features or commitments. Do not add them
during cleanup work without a focused feature specification.

### Voice / session control

- Stop listening.
- Report the current activity or running tool by voice.

### Developer workspace

- Read and search project files.
- Inspect the current workspace or project.
- Show Git status and changed files.
- Run the project's known test command and summarize test failures.
- Open a project or file in VS Code.
- Support contextual follow-ups such as “open that file,” “run the tests
  again,” “which one failed?”, and “ask Codex why.”

### Personal productivity

- Gmail read-only access.
- Local tasks, notes, and reminders.
- A combined daily briefing using Calendar, Gmail, and tasks.
- Create, list, complete, and remove local tasks.
- Local notes and reminders.

### Web

- Search or open GitHub queries.
- Search or open YouTube queries.
- General web search.

### Later / guarded writes

- Create or edit Calendar events only with explicit confirmation.
- Send email only with explicit confirmation.

### Non-goal for the hackathon MVP

- Arbitrary spoken shell commands or arbitrary computer execution.

Before adding any of these, write a small feature specification covering user
value, permissions, security boundary, tool behavior, failure behavior, and
tests. In particular, do not add Gmail access or any write capability without
explicit approval and a separate security review.

## Phase 7 — Demo and submission

**Priority: BEFORE SUBMISSION. Depends on all chosen earlier phases.**

- Run the relevant automated regression tests.
- Update the README with setup, commands, and a concise product description.
- Rehearse the full demo flow using real microphone, AssemblyAI, Calendar, and
  Codex conditions.
- Generate `offscreen.zip` from the exact release commit and verify that it
  contains the same source files as that commit.
- Verify `.env`, `credentials.json`, `token.json`, private keys, and generated
  files are not committed or included in the release archive.
- Review user-facing errors, known limitations, and a simple recovery path for
  failed connections.

The submission should favor a short, reliable demo over additional features or
a broad architectural rewrite.
