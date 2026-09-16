# Offscreen Development Instructions

## Project goal

Offscreen is a voice-first computer companion built for the AssemblyAI Voice Agent Hackathon.

The product should let users complete routine digital tasks with minimal screen and keyboard interaction.

Current core features:
- AssemblyAI voice interaction
- voice-controlled website opening
- Google Calendar read-only queries
- natural-language date parsing
- local Codex read-only repository inspection
- session and tool-turn isolation for asynchronous tool results

Planned features, including Gmail and broader developer workflows, are not
current functionality. See `ROADMAP.md` before treating a planned item as in
scope.

The hackathon deadline is close, so prioritize reliable, demo-ready functionality over unnecessary complexity.

## Development principles

Follow these principles when modifying the project:

- KISS: prefer the simplest design that solves the current problem.
- Avoid premature abstraction.
- Avoid duplicated logic.
- Keep functions small and focused.
- Keep frontend, backend, integration, and parsing responsibilities separate.
- Prefer explicit, understandable code over clever code.
- Preserve working functionality unless a change requires modifying it.
- Do not perform broad refactors unrelated to the current task.
- Do not add dependencies unless they provide clear value.
- Keep secrets server-side.
- Never expose API keys or OAuth credentials to the browser.

## Architecture

Current structure:

- `server.js`
  - Express server
  - API routes
  - AssemblyAI temporary token generation
  - backend integrations

- `calendar.js`
  - Google Calendar authentication
  - Google Calendar queries
  - calendar-specific logic

- `public/index.html`
  - page markup

- `public/styles.css`
  - page styles

- `public/ui.js`
  - DOM lookup and UI rendering

- `public/audio.js`
  - microphone capture
  - AudioWorklet setup
  - PCM encoding/playback
  - audio cleanup

- `public/app.js`
  - AssemblyAI WebSocket session
  - browser-side tool execution
  - session and turn coordination

- `public/pcm-processor.js`
  - microphone PCM audio processing

Do not move backend credentials or Google API logic into the browser.

If a feature grows substantially, prefer extracting it into a dedicated module instead of making `server.js` or `index.html` indefinitely larger.

## Code quality

When implementing changes:

1. Read the relevant existing code first.
2. Understand the current behavior before modifying it.
3. Preserve existing conventions where reasonable.
4. Remove obsolete code after replacing functionality.
5. Avoid dead code.
6. Use descriptive names.
7. Add comments only where the reasoning is not obvious from the code.
8. Handle failure paths explicitly.
9. Avoid swallowing errors silently.
10. Keep user-facing errors concise and understandable.

## Testing

For meaningful behavior changes:

- test the happy path
- test important failure paths
- test parsing / input edge cases where relevant
- verify existing features still work

Prefer lightweight automated tests for deterministic logic.

Good candidates for tests:
- natural-language date parsing
- calendar query routing
- supported website validation
- API route validation
- helper functions

Do not write meaningless tests that only mirror implementation details.

Before considering a task complete:
- run the relevant tests
- run the app if necessary
- check for runtime errors
- verify the feature manually when appropriate

## Refactoring

Refactor only when it improves the current task or prevents obvious near-term problems.

If you notice unrelated architectural problems:
- mention them
- do not automatically rewrite them

## Hackathon priorities

Prioritize:
1. reliability
2. clear user value
3. polished demo flow
4. understandable code
5. additional features

Avoid spending excessive time handling extremely obscure edge cases before the main demo flows work.

## Working style

Before changing code:
- briefly state what you plan to change

After changing code:
- summarize what changed
- list files modified
- state what you tested
- mention any remaining risks

Never claim something works unless you actually verified it.

## Definition of done

A task is not complete until all applicable conditions are satisfied:

- Code is understandable.
- Names describe their purpose.
- Functions have focused responsibilities.
- No obvious duplicated implementation was introduced.
- Existing behavior is preserved unless intentionally changed.
- Relevant tests exist.
- Relevant tests pass.
- Runtime errors were checked.
- The changed feature was manually verified when appropriate.
- Documentation was updated if architecture changed.
- Dead code introduced or made obsolete by the change was removed.
- No secrets or credentials were exposed.
- Codex clearly states what it actually verified.

Never claim that something works unless it was actually verified.

## Engineering guardrails

These rules are non-negotiable unless the user explicitly approves an exception.

### Protect working behavior

- Never intentionally break a currently working feature in order to refactor it.
- Make one logical change at a time.
- Prefer small incremental changes over large rewrites.
- Before a significant refactor, identify the behavior that must remain unchanged.
- After a significant refactor, verify that behavior again.
- Do not remove functionality merely because it complicates the architecture.
- Do not change public behavior unless the task requires it.

### Do not hide failures

Never make a test or error disappear without fixing or understanding its cause.

Do not:
- delete a failing test simply to make the suite pass
- disable validation simply to make an input succeed
- swallow exceptions without a justified reason
- replace real behavior with a mock just to make a test pass
- comment out broken functionality and call the task complete
- silently fall back to invented data when an integration fails

If a failure cannot be fixed safely, report it clearly.

### Scope control

Do not make unrelated changes.

If you notice an unrelated problem:
1. mention it
2. explain its importance
3. leave it unchanged unless it blocks the current task

Do not use a small task as an excuse for a repository-wide rewrite.

### Dependency guardrail

Do not add a package merely for convenience.

Before adding a dependency:
- check whether the platform or existing dependencies already solve the problem
- explain what the dependency provides
- prefer small, maintained dependencies
- avoid introducing a framework for a problem that can be solved simply

Do not change frameworks without explicit approval.

### Architecture guardrail

Do not introduce:
- unnecessary classes
- unnecessary factories
- dependency injection frameworks
- repository/service/controller layers without a real need
- abstractions used only once with no foreseeable benefit
- design patterns merely for the sake of using a design pattern

Architecture exists to make the code easier to understand and change.

KISS takes precedence over architectural cleverness.

### Security guardrail

Never:
- expose secrets to browser code
- commit `.env`
- commit `credentials.json`
- commit `token.json`
- print secret values to logs
- move OAuth credentials into frontend code
- weaken authentication or authorization to make development easier

Treat external input as untrusted.

### Git guardrail

Never run destructive Git operations without explicit approval.

Do not:
- force push
- reset --hard
- delete branches
- rewrite published history
- discard uncommitted user work

Before substantial work, inspect the current Git status.

Do not include unrelated files in a commit.

### Stop conditions

Stop and ask for approval before:

- migrating to React or another framework
- replacing a major library
- changing authentication architecture
- changing OAuth scopes
- adding write access to an external service
- changing database/schema architecture
- introducing a major new dependency
- performing a large multi-file architectural rewrite
- deleting a working feature
- changing the fundamental AssemblyAI voice architecture
- making a security-sensitive change
- performing destructive Git operations

When uncertain whether a change crosses one of these boundaries, stop and explain first. 

## Beginner-readable code

The repository must remain understandable to a beginner developer who knows basic JavaScript.

Readability is a functional requirement, not an optional style preference.

### Naming

Names should describe what the code actually does.

Prefer:

- `getCalendarEventsForDate`
- `parseCalendarQuery`
- `fetchVoiceAgentToken`
- `connectToVoiceAgent`
- `startMicrophoneCapture`
- `stopMicrophoneCapture`
- `playAgentAudio`
- `handleCalendarToolCall`
- `sendToolResult`
- `updateConnectionStatus`

Avoid vague names such as:

- `process`
- `handle`
- `run`
- `manage`
- `doStuff`
- `helper`
- `thing`
- `dataHandler`

A reader should usually understand the purpose of a function from its name without opening its implementation.

### Functions

A function should have one clear responsibility.

Prefer short functions that perform one meaningful operation.

If describing a function requires several unrelated verbs, consider splitting it.

For example:

Bad responsibility:
"parse a date, call Google Calendar, update the UI, and send a WebSocket response"

Better responsibilities:
- `parseCalendarQuery`
- `getCalendarEventsForDate`
- `displayCalendarResult`
- `sendToolResult`

Do not split functions purely to make them shorter if doing so makes the flow harder to understand.

### Control flow

Prefer:
- early returns
- straightforward conditionals
- descriptive intermediate variables
- explicit behavior

Avoid:
- deeply nested conditionals
- clever one-liners
- unnecessary ternary chains
- hidden side effects
- excessive callback nesting

### Comments

Code should explain WHAT through good names.

Comments should primarily explain WHY.

Do not write comments that simply repeat the next line of code.

Use comments when:
- behavior looks strange but is intentional
- an external API has an important limitation
- concurrency/timing behavior is non-obvious
- a security decision needs explanation
- a workaround exists for a documented reason

### Complexity

If there are two solutions that work equally well, prefer the one a beginner can understand more easily. 

## Responsibility and module boundaries

Follow Single Responsibility Principle pragmatically.

A module should have one primary area of responsibility.

Preferred boundaries:

### Browser / frontend

Responsible for:
- UI
- microphone capture
- audio playback
- AssemblyAI WebSocket communication
- browser-only actions
- displaying transcripts and state

The browser must not contain:
- private API keys
- Google OAuth credentials
- server-only authentication logic

### Backend

Responsible for:
- secrets
- API credentials
- OAuth
- external service integrations
- server-side validation
- application API routes

### Integration modules

Each external service should ideally have a dedicated area of code.

Examples:
- AssemblyAI
- Google Calendar
- Gmail

Do not mix unrelated service logic into one large module.

### Parsing / deterministic logic

Logic that does not require network access should be kept separate when practical.

This makes it easier to:
- understand
- test
- reuse
- debug

Examples:
- interpreting calendar queries
- validating supported websites
- formatting API results

### Entry points

Entry-point files such as `server.js` and `app.js` should primarily assemble the application.

They should not gradually become containers for every implementation detail. 

## Explainability requirement

When making a non-trivial change, Codex must be able to explain:

- what changed
- why it changed
- which responsibility each affected file has
- how data flows through the changed code
- how the change was tested

Prefer implementations the user can understand and maintain themselves.

If a proposed implementation is significantly more advanced than necessary, choose a simpler implementation or explain why the complexity is required.
