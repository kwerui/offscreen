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

## Submission checklist

### Copy

- [ ] Confirm final project title.
- [ ] Confirm short description is within the current form limit.
- [ ] Re-read long description against the release commit.
- [ ] Select only technologies/tags actually used.
- [ ] Remove any sentence that depends on a feature that failed final manual
      acceptance.

### Repository

- [ ] Final PR stack reconciled/merged into the intended submission branch.
- [ ] CI green on the exact release commit.
- [ ] Public repository is accessible to judges.
- [ ] README setup works from a fresh clone.
- [ ] No secrets, OAuth files, tokens, or generated ZIPs are tracked.
- [ ] Release ZIP, if needed, is generated from the exact reviewed commit.

### Demo

- [ ] Real microphone + AssemblyAI voice loop verified.
- [ ] Natural interruption verified.
- [ ] Git developer flow verified.
- [ ] Controlled web search verified.
- [ ] Spoken ordinal result opening verified.
- [ ] Calendar OAuth/query verified.
- [ ] Activity receipts verified.
- [ ] Pause/resume or another eyes-free state-control moment verified.
- [ ] Disconnect/reconnect verified.

### Media

- [ ] 16:9 cover image.
- [ ] Video presentation recorded.
- [ ] Video link publicly accessible.
- [ ] Slide/presentation link publicly accessible if required by the form.
- [ ] Screenshots contain no secrets, local absolute paths, or private Calendar
      information.

### Hosting

- [ ] If providing an Application URL, it is a real tested HTTPS URL.
- [ ] Public URL exposes only capabilities intended for hosted mode.
- [ ] Do not list a fake or localhost URL as the public application URL.

## Sources for submission format

The current event page identifies the AssemblyAI - Voice Agent Hackathon as the
September 1–30, 2026 online event:

https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon

Lablab's current 2026 submission guide describes fields including project title,
short and long descriptions, technology/category tags, cover image, video,
GitHub repository, demo platform/URL, and additional information:

https://lablab.ai/ai-articles/hackathon-guidelines

Event-specific form fields can change. Treat the live submission form as the
final authority before submitting.
