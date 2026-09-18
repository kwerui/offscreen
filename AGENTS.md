# Offscreen Development Instructions

## Read first

Before changing this repository, read in order:

1. `PRODUCT_STRATEGY.md`
2. `ROADMAP.md`
3. `docs/ARCHITECTURE.md`
4. `docs/CONVENTIONS.md`
5. `docs/DEVELOPMENT.md`

The latest working tree and latest user instruction are authoritative. Offscreen
is an eyes-free voice control plane for real computer work: AssemblyAI
interprets voice, Offscreen owns state and safety, and tools perform actions.

## Scope and product discipline

- Implement only the requested atomic task. Do not independently broaden
  scope, permissions, architecture, or features.
- Preserve working behavior and avoid adjacent broad refactors.
- Do not optimize for feature count. Favor differentiation, reliable demo
  behavior, and submission strength.
- Use deterministic tools for deterministic actions; use Codex only where
  reasoning is useful.
- MCP exposes bounded Offscreen capabilities, never a full raw tool catalog.
- Keep code beginner-readable: focused responsibilities, descriptive names,
  explicit failure paths, and no needless abstractions or dependencies.

## Protected behavior and lifecycle

Do not casually redesign: AssemblyAI voice interaction; optional exact
“Connect Offscreen” browser wake; natural barge-in; voice disconnect;
standby/resume; cancel work; repeat; summarize/shorten; non-superseding current
activity; allowlisted website opening; read-only Calendar; read-only local
Codex inspection; session/turn isolation; Codex supersession/cancellation; or
tool-result coordination.

Do not reintroduce `get_current_activity`: current activity is client-owned
context. Do not reintroduce a dedicated `stop_current_speech` tool: natural
AssemblyAI barge-in is the chosen behavior.

Long-running tools must define execution mode, cancellation, supersession,
stale-result handling, and activity reporting. Contextual references must be
bounded and cleared when stale. A stale session or tool turn must never mutate
the active lifecycle state.

## Safety boundaries

- Never allow arbitrary spoken shell execution or unrestricted browser/computer
  execution.
- Read, inspect, and navigate may normally run directly; scoped reversible
  edits need clear scope.
- Sending, submitting, deleting, purchasing, publishing, and other
  consequential actions require explicit confirmation immediately before they
  execute.
- Do not add OAuth scopes, write access, or other broader permissions without
  explicit approval.
- Keep secrets server-side. Never expose or commit `.env`, credentials, tokens,
  private keys, or copied secrets.

## Current architecture

- `server.js`: Express, API routes, AssemblyAI temporary tokens, backend work.
- `calendar.js` and `calendar-query.js`: Calendar OAuth/querying and pure date
  interpretation.
- `public/`: browser UI, audio, voice transport, wake listening, tool execution,
  lifecycle coordination, and tool results. See architecture documentation for
  exact module ownership.

Do not move backend credentials or Google OAuth logic into browser code.

## Verification and Git

Before substantial work, inspect `git status`. For every meaningful change,
test happy and important failure paths, run the relevant tests (full `npm test`
after non-trivial changes), run `git diff --check`, and perform an actual diff
review. Manually verify real integrations when they are affected.

Do not hide failures, discard user changes, force-push, reset hard, or commit
temporary ZIPs, secrets, or unrelated files. State exactly what was verified.

## Roles

### Codex

Codex is a fast bounded implementation worker. It implements specified work,
reads existing behavior first, stays within approved permissions, and verifies
the resulting diff. It is not the product manager.

### Work mode

Use Work mode for multi-step operational work, competitor audits, deployment or
submission verification, assets, and cross-file consistency. Do not have Work
mode and Codex concurrently edit the same repository files.
