# Offscreen Roadmap

This roadmap favors differentiated, reliable workflows over feature count. See
[PRODUCT_STRATEGY.md](PRODUCT_STRATEGY.md) for the product decision rule.

## Protected current baseline

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
- Bounded browser navigation, page reading, text finding, and back navigation
  are implemented through the controlled browser adapter.
- Safe browser click and type actions are implemented only against observed
  page references; typing never submits.
- Consequential browser actions require explicit confirmation immediately
  before the stored action executes.
- Local and hosted-safe capability surfaces are separated. `HOSTED_DEMO` does
  not expose local-only capabilities; this does not mean hosted public browser
  automation is finished.
- The agent can query a read-only Google Calendar for named ranges and
  natural-language dates.
- The agent can ask a locally installed Codex CLI to inspect the local project
  in read-only mode.
- The browser displays connection status and user/agent transcripts.
- The user can explicitly enable browser voice wake while disconnected and say
  “Connect Offscreen” to start the normal voice session. Wake recognition is
  stopped while connecting/connected and resumes after disconnect while the
  option remains enabled.
- The browser shows activity/status feedback during long-running tool calls,
  such as while Codex is inspecting the project.
- The user can ask what Offscreen is currently doing while Calendar or Codex
  work is running without superseding that work; ordinary new requests retain
  the existing supersession behavior.
- The agent can end the active voice session when the user explicitly asks to
  disconnect.
- The agent can cancel current in-progress tool work when the user explicitly
  asks, while keeping the voice session connected.
- The agent can enter voice-first standby when the user explicitly asks to
  pause listening. The voice session remains connected and normal requests are
  ignored; users can ask to resume listening or disconnect, and can also use the
  Resume listening UI fallback.
- The agent can repeat its most recent completed spoken response when the user
  explicitly asks.
- The agent can summarize or shorten its most recent completed spoken response
  when the user explicitly asks.

Also protect current activity reporting, session/turn stale-result isolation,
Codex cancellation with its original `call_id`, and tool-result coordination.
Do not reintroduce `get_current_activity` or `stop_current_speech` tools:
activity is client-owned context and natural AssemblyAI barge-in is intentional.

## P0 — Core standout workflows

### 1. Deterministic developer workspace

**Status: implemented; live device acceptance still required where applicable.**

Build read-only Git status and changed-file inspection, bounded project file
search and read, a configured test command, structured test-failure summaries,
and validated VS Code project/file opening. Never permit arbitrary spoken shell
execution. Use Codex only for reasoning handoffs such as “why did this fail?”

### 2. Contextual follow-ups

**Status: substantially implemented for project files, recent commits, and
spoken browser link results; stale-state regression coverage is in CI.**

Support bounded references such as “open that file,” “which test failed?,” “run
those tests again,” and “read that result.” References must expire or clear
safely when stale, and stale session or tool state must not mutate active work.

### 3. Gmail read-only

**Status: not implemented. This remains the main P0 integration requiring a
separate private-data/OAuth decision. Gmail currently opens only as a website.**

Add recent, unread, and important message listing; sender, subject, and basic
query search; message/thread reading; and thread summaries. Do not add send,
reply, delete, archive, or other write actions. Do not broaden OAuth scopes
beyond read-only without explicit approval.

### 4. Higher-level web research

**Status: implemented for the LOCAL demo with fixed-provider public-web search,
bounded snapshots, validated browser actions, and spoken ordinal result
opening; live search quality still needs manual acceptance.**

Build on the existing controlled browser foundation to search the web, inspect
results, and open/read relevant results. Support bounded references such as
“open the second result.” Do not claim arbitrary-site reliability.

### 5. Combined standout workflow

**Status: automated smoke coverage exists for developer state → web search →
Calendar → session evidence → contextual browser opening. Gmail remains absent,
so the full planned cross-domain story is not yet complete. See DEMO.md.**

Combine developer tools, browser research, Calendar, Gmail, and contextual
follow-ups into one continuous eyes-free work session. Activity questions must
not cancel long-running work. Demonstrate concurrency only where lifecycle
safety supports it.

Acceptance for P0: deterministic operations use deterministic tools; all
targets and references are bounded and validated; failures are normalized; and
lifecycle, stale-state, cancellation, and confirmation boundaries are tested
and manually exercised where applicable.

## P1 — Reliability and demo polish

Perform end-to-end manual demo verification, exercise failure and retry
behavior, stale-state safety, cancellation, confirmation, interruption,
standby/resume, and demo rehearsal.

## P1 — Deployment

Hosted-safe mode already exists. After the P0 workflows are strong, complete
token and public-HTTP security, deployment configuration, and application URL
verification. Add bounded hosted browser capability only if time and safety
allow. Do not represent the existing local controlled browser as finished
hosted public browser automation.

## P2 — Submission assets

Prepare README polish, video, slides, cover image, screenshots,
title/descriptions/tags, public repository/default branch, and final
application URL. Acceptance: assets and public claims match the actual product,
and the full demo is rehearsed with real voice/device/integration conditions.

## P3 — Optional after core is strong

Consider write actions, send/reply email, task/reminder writes, broader browser
permissions, Chrome DevTools MCP, and other integrations. Each requires a
focused specification and, for new permissions or writes, explicit approval.

## Feature specification template

```text
Goal
User value
Demo scenario
Allowed scope
Protected behavior
Security boundary
Failure behavior
Acceptance criteria
Verification
```
