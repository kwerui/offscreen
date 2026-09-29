# Offscreen Hackathon Submission Pack

This is the working submission copy for the **AssemblyAI - Voice Agent
Hackathon** on lablab.ai (September 1–30, 2026).

Current event:
https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon

Lablab submission guidance:
https://lablab.ai/ai-articles/hackathon-guidelines

Keep every public claim aligned with the reviewed release commit and the
live-tested demo. Do not copy LOCAL-only claims into a hosted demo unless they
are actually available there.

## Project title

**Offscreen — Eyes-Free Voice Control for Real Work**

The title is under lablab's current 50-character guidance.

## Short description

Offscreen is a voice-first computer companion that safely handles real work
across developer tools, web research, and Calendar while you stay focused away
from the screen.

Use this as the starting point for lablab's short-summary field. Keep the final
version under the platform's current 255-character guidance.

## Long description

Most voice assistants are good at answering questions. Offscreen is built to
get bounded computer work done while demanding as little screen and keyboard
attention as possible.

Offscreen uses the AssemblyAI Voice Agent API for the live conversation loop:
microphone audio is streamed from the browser, AssemblyAI interprets the user's
speech, chooses from a deliberately small tool surface, and speaks the result
back. The application owns the state and safety around those tools instead of
turning spoken language into arbitrary computer commands.

A user can wake Offscreen by voice, inspect the current Git working state, run
the configured project tests, search and read project files, inspect current
diffs and recent commits, and open validated project files in VS Code. Offscreen
can also query a read-only Google Calendar and use a controlled Playwright MCP
browser for bounded public-web research. After Ivy names browser results, a
follow-up such as “open the second result” can resolve only an ordinary link
that was actually observed and spoken in the current context.

The experience is designed for continuous eyes-free work. Users can interrupt
a spoken response naturally, cancel current work, pause and resume listening,
repeat or shorten the previous response, ask what Offscreen is currently doing,
and ask what it has done so far. A session-local Activity panel shows bounded
action receipts so tool outcomes are visible evidence rather than conversational
claims.

Safety is part of the product rather than a disclaimer. Deterministic jobs use
fixed deterministic tools; project paths and browser references are validated;
late results from stale turns are ignored; consequential browser actions require
a later explicit confirmation; raw shell commands are never accepted; Calendar
is read-only; and LOCAL-only capabilities are separated from the hosted-safe
surface.

Offscreen is a hackathon prototype, not arbitrary computer control. Gmail
message reading, Calendar writes, and a production public deployment are not
claimed. The current strongest demo runs locally and shows one voice session
moving from developer work to web research to Calendar to grounded action
evidence and contextual follow-ups.

## Problem

Computer work constantly pulls attention back to the screen even when the task
itself is simple: check whether tests pass, see what changed, look something up,
check the calendar, or reopen the result just mentioned.

Existing voice assistants often stop at conversation. Giving a language model
unrestricted computer control solves the opposite problem by creating too much
authority. Offscreen explores the middle ground: useful real actions that can be
performed eyes-free, with narrow deterministic tools and explicit safety
boundaries.

## Solution

Offscreen separates the voice model from operational authority:

**AssemblyAI interprets voice. Offscreen owns state and safety. Tools perform
bounded actions.**

That architecture lets the conversation stay natural while each action remains
constrained by code:

- Git status, diff, history, search/read, tests, and file opening use fixed
  developer tools rather than arbitrary spoken shell execution.
- Browser actions operate only through a bounded Playwright MCP adapter.
- Contextual browser ordinals use only ordinary links that were actually
  observed and spoken.
- Consequential browser actions are held behind a later explicit confirmation.
- Calendar access is read-only.
- Session and tool-turn ownership prevent stale completions from changing the
  active conversation.
- Action receipts provide visible evidence of what actually completed.

## Why voice matters

Offscreen is not a text agent with a microphone added on top. Important product
state is controlled by voice:

- disconnected wake phrase;
- natural AssemblyAI barge-in;
- pause/resume listening with audible cues;
- cancellation and disconnect;
- repeat/shorten;
- “what are you doing?” during supported long-running work;
- contextual follow-ups like “open the second result”;
- spoken summaries of deterministic tool results.

The goal is to let the user keep attention on another physical or cognitive
task while still progressing through computer work.

## AssemblyAI use

Offscreen uses the **AssemblyAI Voice Agent API** as the live interaction layer.

The browser:

1. requests a short-lived Voice Agent token from the local Express server;
2. captures microphone audio and converts it to 24 kHz PCM;
3. streams audio over the Voice Agent WebSocket;
4. receives transcripts, tool calls, spoken-response audio, and interruption
   state;
5. returns bounded tool results through the same voice session.

Natural interruption uses the Voice Agent input interruption behavior rather
than a fake “stop speaking” tool.

## Key demo features

Prioritize these in the presentation:

1. **Voice wake and real-time conversation**
   - “Connect Offscreen.”
2. **Deterministic developer work**
   - “What’s my Git status?”
3. **Bounded web research**
   - “Search the web for AssemblyAI voice agents.”
   - “Open the second result.”
4. **Read-only productivity**
   - “What do I have today?”
5. **Evidence**
   - “What have you done so far?”
   - Show the Activity panel.
6. **Eyes-free control**
   - Pause/resume listening or demonstrate natural interruption.
7. **Safe ending**
   - “Disconnect.”

See [DEMO.md](DEMO.md) for the full rehearsal and manual acceptance checklist.

## Technical highlights

- AssemblyAI Voice Agent API
- Browser WebSocket voice session
- 24 kHz PCM AudioWorklet microphone pipeline
- Node.js + Express local server
- deterministic read-only Git tooling
- bounded project file search/read
- configured project test runner with cancellation
- validated VS Code file opening
- Playwright MCP controlled-browser adapter
- bounded fixed-provider public-web search
- read-only Google Calendar API integration
- local Codex CLI reasoning handoff in a filtered read-only workspace
- contextual project, commit, and browser references
- session/turn stale-result isolation
- explicit browser confirmation flow
- bounded session action receipts
- GitHub Actions CI

## Suggested technologies / tags

Choose only tags that exist in the current lablab submission UI.

Strong matches:

- AssemblyAI
- Voice Assistant
- Developer Tools
- Productivity
- Web Application
- JavaScript
- Node.js
- REST API
- Codex

Do not add a technology merely for visibility if it is not actually used.

## GitHub repository

https://github.com/kwerui/offscreen

Before submission:

- merge/reconcile the reviewed draft-PR stack;
- make the intended release branch/default branch easy for judges to find;
- confirm CI passes on the exact release commit;
- confirm README setup instructions match that commit;
- do not recommit generated ZIP release artifacts.

## Demo application

**Platform:** TBD

**Application URL:** TBD

Do not invent a hosted URL. The current full-featured demo is LOCAL and the
server intentionally binds to loopback. HOSTED_DEMO has a restricted capability
surface and is not equivalent to the LOCAL controlled-browser/developer demo.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) before any public deployment work.

## Video presentation

**Video URL:** TBD

Lablab's current general submission guide allows a video presentation up to five
minutes. For Offscreen, target roughly **2.5–3.5 minutes** unless the current
event submission UI specifies something stricter.

Recommended structure:

### 0:00–0:20 — Problem

“Most voice assistants answer questions. Offscreen is built to get bounded real
computer work done while you keep your eyes off the screen.”

Show the idle Offscreen UI and Activity panel.

### 0:20–0:45 — Voice-native setup

Demonstrate “Connect Offscreen” or connect manually, then briefly show natural
conversation/interruption.

Explain in one sentence that the live loop is AssemblyAI Voice Agent API:
speech in, tool calls when needed, spoken result out.

### 0:45–1:20 — Developer action

Ask:

“What’s my Git status?”

Then optionally:

“Run my project tests.”

Keep this fast. The point is that deterministic work uses deterministic tools,
not a free-form shell agent.

### 1:20–1:55 — Web research + context

Ask:

“Search the web for AssemblyAI voice agents.”

After Ivy names results:

“Open the second result.”

Show that the browser opens the spoken result without the user needing to read
or repeat a URL.

### 1:55–2:20 — Productivity + evidence

Ask:

“What do I have today?”

Then:

“What have you done so far?”

Show the Activity panel updating with actual completed actions.

### 2:20–2:45 — Safety / eyes-free control

Demonstrate one:

- interrupt Ivy naturally;
- pause and resume listening;
- show a consequential browser action requiring explicit confirmation.

Explain that Offscreen does not accept arbitrary spoken shell commands or
unconfirmed consequential actions.

### 2:45–3:05 — Close

Summarize:

“AssemblyAI interprets voice. Offscreen owns state and safety. Narrow tools do
the work.”

End on the product name and repository/demo links.

## Presentation / slide outline

If lablab asks for a slide presentation, keep it short.

### Slide 1 — Offscreen

**Eyes-free voice control for real computer work**

One sentence:
Most voice assistants answer; Offscreen safely acts.

### Slide 2 — The problem

- routine computer tasks constantly steal visual attention;
- conversational assistants often stop before real work;
- unrestricted agents have too much authority.

### Slide 3 — The experience

Voice flow:

**Speak → AssemblyAI Voice Agent → bounded tool → verified result → spoken
follow-up**

Examples:
Git status, project tests, web research, Calendar, contextual open.

### Slide 4 — Safety architecture

**AssemblyAI interprets voice. Offscreen owns state and safety. Tools perform
actions.**

Show:
- deterministic tools;
- session/turn guards;
- explicit confirmation;
- action receipts.

### Slide 5 — What makes it voice-native

- wake phrase;
- natural barge-in;
- pause/resume;
- contextual spoken references;
- current-work and completed-action questions.

### Slide 6 — Demo

One continuous sequence:

Git → web search → open spoken result → Calendar → activity evidence.

### Slide 7 — Current scope and next steps

Implemented:
- LOCAL developer workflow;
- bounded browser research;
- read-only Calendar;
- evidence/lifecycle safety.

Not claimed:
- Gmail reading;
- Calendar writes;
- arbitrary computer control;
- production public hosting.

Next:
- live acceptance and submission polish;
- hosted deployment only after public token/security controls;
- optional private-data integrations with deliberate permission design.

## Cover image brief

Lablab currently recommends a 16:9 cover image.

Suggested visual:

- dark Offscreen interface;
- central audio waveform / microphone motif;
- three restrained action cards around it: **Code**, **Web**, **Calendar**;
- a small verified Activity trail beneath them;
- headline: **Offscreen**
- subtitle: **Eyes-free voice control for real work**

Avoid showing fake integrations or features not in the demo.

## Additional information for judges

Suggested copy:

> Offscreen deliberately avoids arbitrary computer control. The full developer,
> Calendar, Codex, and controlled-browser workflow currently runs in LOCAL mode
> because those capabilities depend on local project state, desktop OAuth, or
> local tooling. The repository also contains a separate HOSTED_DEMO capability
> surface that omits those local-only APIs. The demo and README distinguish
> these surfaces rather than presenting unavailable local features as hosted.
>
> Automated GitHub Actions cover the deterministic tool and lifecycle behavior,
> including stale-result isolation, browser confirmation, contextual references,
> action receipts, web search, and a combined cross-domain workflow. Real
> microphone, AssemblyAI, Calendar OAuth, and browser integration behavior is
> separately listed for manual acceptance in DEMO.md.

## Submission requirements audit — 28 September 2026

**Status labels:** **REQUIRED** is confirmed by the public Lablab event or
submission guide. **READY** means the repository contains a usable draft or
implementation. **MISSING** means no submission-ready artifact/link was found
in the reviewed release candidate. **HUMAN ACTION** needs access to the
Lablab form, GitHub settings, external hosting, or a real device/account; it
cannot be truthfully completed from this repository.

The live event page is the final authority if its authenticated form differs
from this audit. Do not substitute a recommendation below for a form field.

### Confirmed event and eligibility

- **REQUIRED — build on AssemblyAI.** The event says every participant builds
  on AssemblyAI. **READY:** the README and this document accurately describe
  use of the AssemblyAI Voice Agent API. **HUMAN ACTION:** retain this clear
  disclosure in the final project story and select the AssemblyAI technology
  tag only if it is offered by the form.
- **REQUIRED — submit by 30 September 2026, 15:00 UTC.** **HUMAN ACTION:**
  submit before the displayed event deadline; do not rely on this document as
  a clock or assume a grace period.
- **REQUIRED — Lablab profile, registration, Discord connection, and team.**
  The public guide requires a completed profile, event registration, Discord
  connection, and creating or joining a team; the platform FAQ says every team
  member must register independently. **HUMAN ACTION:** verify every member is
  registered, linked to the correct team, and shown in the submitted project.
- **UNCONFIRMED — event-specific eligibility, originality, team-size limit,
  tracks, and judging weights.** No public event-specific rulebook or rubric
  was accessible during this audit. **HUMAN ACTION:** inspect the current
  authenticated event page/Discord and record any such requirements before
  submitting. Do not claim a track or judging criterion that is not displayed.

### Required submission fields and media

- **REQUIRED — title (maximum 50 characters). READY:** “Offscreen — Eyes-Free
  Voice Control for Real Work” is 49 characters. **HUMAN ACTION:** paste it
  into the live form and confirm its character counter accepts the em dash.
- **REQUIRED — short description (maximum 255 characters). READY:** the draft
  above is 171 characters. **HUMAN ACTION:** use the current form counter as
  final authority.
- **REQUIRED — long description (minimum 100 words). READY:** the grounded
  draft above exceeds the minimum and discloses AssemblyAI use, LOCAL-only
  scope, and safety boundaries. **HUMAN ACTION:** remove any claim that fails
  final manual acceptance.
- **REQUIRED — main track(s) and technologies. MISSING:** no selected track
  or final platform-tag record exists in the repository. **HUMAN ACTION:**
  select only live form choices that apply; begin with the suggested tags above
  and include AssemblyAI.
- **REQUIRED — cover image. MISSING:** no image asset was found. The guide
  recommends a 16:9 ratio. **HUMAN ACTION:** create/upload a truthful 16:9
  thumbnail using the cover brief above; do not show private Calendar data,
  secrets, absolute local paths, or unavailable integrations.
- **REQUIRED — video presentation. MISSING:** no recorded video or public URL
  was found. The guide specifies a link, under 300 MB and no longer than five
  minutes. **HUMAN ACTION:** record the tested LOCAL flow, upload it to a
  publicly playable service, and paste its URL. The 3:05 script above is a
  content-ready plan, not a completed video.
- **REQUIRED — GitHub repository link. READY:**
  https://github.com/kwerui/offscreen is the configured `origin` and the README
  provides setup and scope. **HUMAN ACTION:** confirm it is accessible to
  unauthenticated judges and that the default branch contains or clearly links
  to the exact release commit. The public guide requires the link but does not
  itself state “public”; judge accessibility is essential verification, not an
  invented event rule.
- **REQUIRED — demo platform and demo URL. MISSING:** both remain `TBD`.
  **HUMAN ACTION:** either supply a real, tested HTTPS deployment whose public
  capability surface matches its description, or verify with the live form
  whether a local-demo/video-only submission is accepted. Never submit
  localhost or a fabricated URL. `docs/DEPLOYMENT.md` records why a public
  deployment is not currently ready.
- **REQUIRED — additional information. READY:** the judge copy above clearly
  explains the LOCAL versus HOSTED_DEMO boundary. **HUMAN ACTION:** paste and
  trim it for the form without promising public capabilities that do not exist.

### Release, demo, and evidence gate

- **REQUIRED — a usable online prototype. MISSING for public access:** the
  platform FAQ says a complete submission needs a working prototype others can
  use online, and the submission form guidance includes a demo platform and
  direct demo URL. The strongest workflow is intentionally LOCAL and the
  server is loopback-bound. **HUMAN ACTION:** complete the documented
  hosted-security preflight and publish a truthful HTTPS demo, unless the live
  authenticated form explicitly provides and accepts an alternative.
- **READY — repository documentation:** README, DEMO.md, SUBMISSION.md, and
  deployment preflight exist and distinguish implemented LOCAL behavior from
  hosted-safe behavior.
- **MISSING — final manual acceptance record:** microphone/AssemblyAI session,
  wake phrase, real Calendar query, live search, spoken ordinal open,
  interruption, pause/resume, receipts, and reconnect still need the final
  run recorded in DEMO.md or release notes. **HUMAN ACTION:** perform this on
  the recording machine after the acceptance-blocker fixes land.
- **MISSING — exact-release CI evidence:** a GitHub Actions test workflow is
  present, but this audit did not independently obtain a run for the final
  post-fix commit. **HUMAN ACTION:** confirm `npm test` and GitHub Actions are
  green on that exact commit before marking PR #10 ready. Keep PR #10 draft
  until this and manual acceptance pass.
- **HUMAN ACTION — repository hygiene:** verify a fresh clone starts from the
  README, the intended submission/default branch is discoverable, no secrets
  are tracked, and generated `.playwright-mcp/` state remains ignored.

### Recommended polish (not confirmed event requirements)

- **MISSING — screenshots.** Capture two or three truthful, redacted product
  screenshots for the project page/video thumbnail. They improve judge context
  but the public guide does not list them as a required field.
- **MISSING — slide deck artifact.** Lablab’s FAQ says a complete hackathon
  submission needs a pitch deck, while the current event submission guide
  explicitly requires the fields above and does not expose a deck-upload field.
  The seven-slide outline above is therefore ready as content, but no deck file
  is required by the accessible event form. **HUMAN ACTION:** create/export a
  concise deck only if the authenticated form, organizers, or live judging
  instructions request it; otherwise use the outline to structure the video.
- **RECOMMENDED — judging alignment.** Lead the video/story with a working
  voice-native workflow, explicit AssemblyAI usage, bounded safety, real
  evidence receipts, and a concrete productivity problem. These are product
  strengths, not claimed published judging weights.

## Authoritative sources checked

- Event page (event identity, AssemblyAI requirement, dates and deadline):
  https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon
- Lablab submission guide (field limits, media, repository, demo platform/URL,
  and additional information):
  https://lablab.ai/ai-articles/hackathon-guidelines
- Lablab platform guide/FAQ (registration, team membership, working online
  prototype, video presentation, pitch deck): https://lablab.ai/guide

The authenticated submission form and any event-specific rules shown there are
authoritative over generic platform guidance. No public Devpost page or
event-specific published judging rubric was found for this Lablab event during
the audit.
