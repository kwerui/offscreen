# Offscreen Engineering Conventions

These conventions optimize for a small, reliable hackathon project that a
beginner developer can understand and maintain. They apply to application code,
tests, and future refactoring work.

## Keep it simple (KISS)

Prefer the smallest clear solution that supports the current requirement.

- Use plain functions and objects before adding classes, factories, or a
  framework.
- Prefer a short explicit conditional to a generic system used once.
- Do not add a package if Node, the browser, or an existing dependency already
  solves the problem.
- Do not refactor unrelated working code while implementing a small change.

Good: extract `parseCalendarQuery` because it is deterministic and needs tests.

Not yet justified: a generic integration framework for Calendar, Codex, and
future services that do not share enough behavior.

## Practical Single Responsibility Principle

A function or module should have one main reason to change. This does not mean
every function must be tiny; it means its work should fit one understandable
sentence.

Good separation:

```js
const query = parseCalendarQuery(when, calendarTimezone);
const calendarEvents = await getCalendarEventsForDate(query.date);
sendToolResult(callId, calendarEvents);
```

Avoid one function that parses a date, calls Google, changes the transcript,
and sends a WebSocket message. Those are separate responsibilities.

## Separation of concerns

- **Browser:** UI, microphone capture, audio playback, AssemblyAI WebSocket,
  browser-only actions, and visual status.
- **Backend:** secrets, token minting, OAuth, external-service requests, input
  validation, and HTTP responses.
- **Integration modules:** one external service's API details, such as Google
  Calendar.
- **Pure modules:** deterministic parsing, formatting, and validation that do
  not need a network request.

Never put AssemblyAI API keys, Google OAuth credentials, or server-only
authentication in browser code.

## DRY without premature abstraction

Do not duplicate substantial behavior, but do not force two things together
before their common shape is clear.

Extract a helper when the same logic is repeated and the helper name explains
the shared idea:

```js
function formatCalendarEvents(items) {
  return items.map(formatCalendarEvent);
}
```

Do not create an abstract `processIntegrationResult` helper merely because two
unrelated integrations both return data.

## Names

Names should communicate purpose without making the reader open the function.

Prefer verbs that state the actual action:

- `getCalendarEventsForDate`
- `parseCalendarQuery`
- `connectToVoiceAgent`
- `startMicrophoneCapture`
- `stopMicrophoneCapture`
- `handleCalendarToolCall`
- `sendToolResult`
- `updateConnectionStatus`

Use nouns that say what a value contains:

```js
const calendarTimezone = calendarInfo.data.timeZone;
const pendingToolResults = [];
const requestedDate = query.date;
```

Avoid vague names such as `process`, `run`, `handle`, `manage`, `helper`,
`thing`, `doStuff`, `data`, or `result` when a more precise name is possible.
`handle` is acceptable only when paired with the exact event or action, such as
`handleCalendarToolCall`.

### Boolean names

Start booleans with a question-like word:

- `isVoiceSessionActive`
- `isToolReplyComplete`
- `hasPendingToolResults`
- `canSendToolResults`

Avoid ambiguous names such as `ready`, `status`, or `done` when the reader
cannot tell what is ready, what status is represented, or what finished.

## Functions and control flow

- Give each function one clear responsibility.
- Prefer early returns for invalid input and unsupported cases.
- Avoid deep nesting; extract a named helper when it clarifies the branch.
- Use descriptive intermediate values instead of dense expressions.
- Keep asynchronous setup and cleanup visibly paired.

Prefer:

```js
function getSupportedSiteUrl(site) {
  const url = SITE_URLS[site];

  if (!url) {
    return null;
  }

  return url;
}
```

Over a deeply nested branch that checks several unrelated concerns at once.

## Comments

Code should explain **what** through structure and names. Comments should
explain **why**, especially for external API constraints, security decisions,
or non-obvious timing behavior.

Useful:

```js
// Ignore callbacks from an earlier WebSocket after the user reconnects.
if (sessionId !== activeSessionId) return;
```

Unhelpful:

```js
// Set the status text.
statusText.textContent = text;
```

## Async code and lifecycle state

Async code must make ownership and cleanup clear.

- One voice-session owner should know whether a callback belongs to the active
  connection.
- Every async operation needs an explicit success path and failure path.
- Disconnecting must stop or invalidate work that can still finish later.
- Associate each asynchronous tool operation with its `sessionId` and
  `toolTurnId`; do not let an earlier operation update a newer turn.
- When superseding an interactive tool call that requires a result, resolve
  the original `call_id` explicitly before invalidating its turn.
- Timeouts must agree across layers. For example, a server-side Codex timeout
  must finish before the voice tool's declared timeout.
- Do not reuse a global result queue for a newer session without identifying
  which session produced each result.

## Errors and logging

- Validate input at the boundary where it enters the system.
- Return concise, safe errors to the browser.
- Log enough context to diagnose a failure, but never log secret values.
- Do not silently swallow a failure unless it is an expected best-effort
  cleanup case; document why that cleanup can safely be ignored.
- Do not return raw process stderr or upstream API details to users unless they
  are known safe.

Example:

```js
if (!when) {
  return res.status(400).json({ error: "Calendar query is required" });
}
```

## External API boundaries

Treat AssemblyAI, Google Calendar, Codex, and browser input as untrusted
boundaries.

- Validate request shape before using it.
- Normalize external responses into small Offscreen-owned objects.
- Keep API-specific details inside the owning integration module.
- Preserve useful errors in server logs while returning a stable user-facing
  error message.
- Do not invent Calendar data when an integration fails.

## Security and secrets

- Keep `ASSEMBLYAI_API_KEY` in `.env`, never in browser code.
- Keep Google OAuth credentials and tokens local and server-side.
- Never commit `.env`, `credentials.json`, `token.json`, private keys, or
  copied secret values.
- Use the minimum OAuth scope required; Calendar is currently read-only.
- Treat the Codex endpoint as local/trusted-user functionality until a
  deliberate authentication and deployment design exists.
- Do not log full credentials, bearer tokens, or private task content.

## Dependency decisions

Before adding a dependency, answer:

1. Can existing code, Node, or the browser solve this clearly?
2. What specific problem does the dependency solve?
3. Is its maintenance and security posture acceptable?
4. Is the added complexity worth it before the hackathon?

Record the reason in the change description. Do not add React, a bundler, or a
test library solely because they are common.

## Testing

Test behavior, not implementation details.

- Test deterministic parsing and validation first.
- Include normal inputs, invalid inputs, and important edge cases.
- Manually verify real microphone, WebSocket, Calendar, and Codex behavior when
  a change affects those integrations.
- Do not remove a failing test just to get green output; understand and repair
  the behavior or explain why it is intentionally deferred.

Run `npm test` to use Node's built-in test runner. The current suite covers
deterministic Calendar parsing and timezone behavior; it does not replace
manual integration checks.

## Git discipline

- Inspect `git status` before substantial work.
- Make one logical change at a time.
- Keep refactors separate from feature changes where practical.
- Review `git diff` before committing.
- Use a descriptive commit message, for example:

  ```text
  fix: isolate tool results by voice session
  ```

- Never force-push, reset hard, discard user work, or rewrite published history
  without explicit approval.
- Do not include unrelated files or secrets in a commit.

## Definition of Done

A change is done only when applicable items are true:

- The code is understandable to a beginner developer.
- Names and responsibilities are clear.
- Existing behavior is preserved unless intentionally changed.
- Relevant deterministic tests exist and pass.
- Relevant real integrations were manually checked.
- Error and failure paths were considered.
- No secrets were exposed or committed.
- Obsolete code created by the change was removed deliberately.
- Documentation reflects architectural changes.
- The final summary states what was actually verified and any remaining risk.
