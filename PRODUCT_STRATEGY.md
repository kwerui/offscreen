# Offscreen Product Strategy

## North star

Offscreen is an eyes-free voice control plane for real computer work. A user
should be able to start, inspect, redirect, pause, resume, and complete useful
work by voice while giving minimal attention to the screen and keyboard.

**Most voice assistants answer questions. Offscreen gets work done.**

## Product pillars

1. **Eyes-free operation** — voice wake, natural interruption, standby/resume,
   repeat, shorten, cancellation, disconnect, and current-activity reporting.
2. **Real actions** — bounded browser, developer-workspace, and productivity
   capabilities.
3. **Long-running work** — work can remain active while the user asks what is
   happening; stale and late results must remain lifecycle-safe.
4. **Contextual follow-ups** — bounded references such as “open that file,”
   “run those tests again,” and “which one failed?”
5. **MCP extensibility** — MCP is an integration path, not a raw tool catalog
   forwarded to AssemblyAI. Offscreen exposes a small, safe capability surface.
6. **Explicit safety** — inspect, read, and navigate normally run directly;
   scoped reversible edits require clear scope; sending, submitting, deleting,
   purchasing, publishing, and other consequential actions require confirmation
   immediately before execution.

Architecture follows one rule: **AssemblyAI interprets voice. Offscreen owns
state and safety. Tools perform actions.**

## Demo domains and decision rule

The primary demo domains are bounded browser automation, a deterministic
developer workspace, and read-only Calendar productivity. Prefer deterministic
tools for deterministic tasks (Git status, file search, known tests, validated
VS Code opening); reserve Codex for reasoning such as diagnosis or architecture
analysis. Gmail, tasks, notes, and reminders are lower priority.

Every remaining task must make Offscreen more differentiated, make the demo
more reliable, or make the submission stronger. A few coherent, dependable
workflows beat a large collection of shallow tools.

Target demo: wake Offscreen; start developer work; use browser automation while
it runs; ask “What are you doing?” without cancellation; make a contextual
follow-up; demonstrate interruption or standby/resume; receive completion; and
disconnect. Do not fake concurrency—narrow the demo if the lifecycle cannot
safely support it.

## Positioning and non-goals

Offscreen is not a Siri clone, a generic chatbot with many tools, a voice
debugger, or arbitrary computer control. Its advantage is stateful, safe,
eyes-free completion of real work.

It will not accept arbitrary spoken shell commands, unrestricted browser or
computer execution, broad raw MCP catalogs, or unconfirmed consequential
actions. Current capabilities must never be described as hosted public service
features when they rely on loopback binding, desktop Calendar OAuth, or a local
Codex CLI.

## Submission strategy

Deployment and a public demo are P0. The submission needs a title, short and
long descriptions, tags, cover image, video, slides, public GitHub repository,
demo platform, and application URL. Treat each as product work; validate claims
against the actual deployed capability rather than local assumptions.

## Execution roles

| Role | Owns |
| --- | --- |
| Human | Product scope and security decisions; live voice/device acceptance. |
| ChatGPT | Strategy, architecture, specifications, acceptance criteria, reviews, and submission strategy. |
| Codex | Fast, bounded implementation and verification; does not independently expand scope, permissions, architecture, or features. |
| Work mode | Multi-step audits, deployment and submission verification, assets, and cross-file consistency. |

Do not have Work mode and Codex edit the same repository files concurrently.
