# Offscreen Demo Rehearsal

This script is for the LOCAL developer demo. It matches the capabilities
currently implemented in the repository. Do not describe local-only features as
available in HOSTED_DEMO.

## Demo story

Offscreen is an eyes-free control plane for real computer work. The demo should
show one continuous voice session moving between developer work, public web
research, Calendar, contextual follow-ups, evidence of completed actions, and
listening controls.

## Recommended live sequence

Before recording:

- start Offscreen in LOCAL mode;
- make sure the configured project has at least one harmless Git change;
- make sure Google Calendar OAuth is already authorized;
- install Playwright Chromium for the controlled browser;
- enable the Wake Phrase preference if you want to demonstrate disconnected
  voice wake;
- keep the Activity panel visible in the recording when practical.

Suggested voice flow:

1. **Wake**
   - While disconnected: “Connect Offscreen.”
   - Expected: the normal AssemblyAI voice session connects. Browser wake
     recognition stops while connected.

2. **Developer state**
   - “What’s my Git status?”
   - Expected: deterministic get_git_status; Ivy reports current staged,
     unstaged, or untracked state without using Codex.

3. **Public web research**
   - “Search the web for AssemblyAI voice agents.”
   - Expected: browser_search_web uses the fixed provider through the
     controlled browser, reads a bounded snapshot, and names useful result
     links.
   - Follow with: “Open the second result.”
   - Expected: browser_open_result resolves only against ordinary link labels
     Ivy actually spoke and uses the existing validated click path.

4. **Calendar**
   - “What do I have today?”
   - Expected: read-only get_calendar_events using the real Calendar account.

5. **Evidence / trust**
   - “What have you done so far?”
   - Expected: get_session_activity summarizes actual session receipts rather
     than conversation memory.
   - The Activity panel should show recent verified actions, newest first.

6. **Eyes-free listening control**
   - “Pause listening.”
   - Expected: descending earcon, microphone ownership moves to the narrow local
     standby listener, and ordinary connected requests are ignored.
   - “Resume listening.”
   - Expected: ascending earcon and normal AssemblyAI microphone capture
     resumes.

7. **Response control**
   - After any useful completed response: “Repeat that.”
   - Expected: repeat_last_response repeats the latest completed Offscreen
     response without rerunning the previous tool.

8. **End**
   - “Disconnect.”
   - Expected: the current voice session ends. If Wake Phrase remains enabled,
     disconnected wake recognition may resume.

## Optional developer deep-dive

Use only if the main demo is already reliable:

- “Run my project tests.”
- “Did the tests pass?”
- “What changed?”
- “What were my recent commits?”
- “What changed in the second commit?”
- “Search the project for run project tests.”
- After Ivy names paths: “Open the second one.”
- “Open it at line 120.”

These demonstrate deterministic execution, contextual references, interruption,
and visible action receipts without allowing arbitrary spoken shell commands.

## Automated coverage

GitHub Actions should pass before a demo build is considered ready. The Node
suite covers, among other things:

- session/turn stale-result isolation;
- deterministic Git status/diff/history and project workspace tools;
- configured project test execution and cancellation;
- validated VS Code file opening;
- wake phrase and standby/resume state;
- consequential browser confirmation;
- session action receipts and stale-receipt terminalization;
- bounded public web search;
- spoken-only browser ordinal results;
- a mixed-domain Git → web search → Calendar → activity → contextual-open flow.

## Manual acceptance still required

Automated tests cannot prove real microphone/device/integration behavior. Before
submission, manually verify:

- microphone permission and real AssemblyAI transcription;
- natural interruption while Ivy is speaking;
- disconnected wake phrase on the target browser;
- pause/resume earcons and microphone handoff;
- real Calendar OAuth/query behavior;
- Playwright Chromium startup on the demo machine;
- live public-web search result quality;
- opening one spoken search result;
- Activity panel behavior during real tool calls;
- disconnect/reconnect.

## Claims to avoid

Do not claim any of the following unless they are implemented and live-tested:

- Gmail inbox/message reading — Offscreen currently only opens the Gmail site;
- sending or replying to email;
- Calendar writes;
- arbitrary shell commands;
- arbitrary computer control;
- hosted public browser automation equivalent to the LOCAL controlled browser;
- perfect reliability on every website.
