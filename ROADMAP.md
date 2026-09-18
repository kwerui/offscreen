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

## P0 — Submission-critical

### Hosted/demo architecture

Why: a public demo cannot inherit local loopback binding, desktop OAuth, and a
local Codex CLI without an explicit hosted-safe design. Acceptance: document
hosted versus local-only capabilities, deploy only supported capabilities, and
verify the public application URL.

### Bounded browser automation through MCP

Why: real browser work is the next clearest differentiator. Demo: navigate and
act on a bounded target while developer work runs. Security: adapters validate
inputs and require confirmation for consequential actions. Acceptance: no raw
MCP catalog reaches AssemblyAI; success, failure, cancellation, and stale
completion paths are verified.

### Confirmation policy and public readiness

Why: safety and credible submission claims are product requirements.
Acceptance: confirmation occurs immediately before destructive/external actions;
repository, demo, and public claims are reviewed against reality.

## P1 — Standout developer workflow

Build read-only Git status/changed files, project-contained file read/search,
a configured test command with failure summary, and validated VS Code opening.
Use Codex only for reasoning handoff such as “why did this fail?” Add bounded,
clearable contextual references. Never permit arbitrary spoken shell commands.

Acceptance: deterministic operations use deterministic tools; every target is
validated; failures are normalized; lifecycle and confirmation boundaries are
tested and manually exercised where applicable.

## P1 — Standout combined demo

Combine browser and developer work with non-superseding activity questions,
interruption or standby, contextual follow-up, and completion. Acceptance: the
demo is real—concurrency is demonstrated only if lifecycle safety supports it.

## P2 — Submission and presentation

Prepare GitHub polish, title, short/long description, tags, cover, video,
slides, screenshots, architecture visual, application URL, and rehearsal.
Acceptance: assets match current functionality and the full demo is rehearsed
with real voice/device/integration conditions.

## P3 — Only after core is strong

Evaluate Chrome DevTools MCP, Gmail read-only, tasks/notes/reminders, combined
briefing, and guarded writes. Each requires a focused specification and, for
new permissions or writes, explicit approval.

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
