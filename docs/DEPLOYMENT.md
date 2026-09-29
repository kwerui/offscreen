# Hosted Deployment Preflight

Offscreen has a HOSTED_DEMO capability mode, but the repository is **not yet
configured for public Internet exposure**. This document separates the
hosted-safe capability surface from the remaining deployment-security work.

## Current hosted-safe behavior

When OFFSCREEN_MODE is exactly HOSTED_DEMO:

- Calendar routes are not registered.
- Local Codex routes are not registered.
- Developer-workspace routes are not registered.
- Controlled-browser MCP routes are not registered.
- The browser receives the hosted-safe capability payload only.
- Missing or malformed runtime capability data falls back to hosted-safe mode.

The server also applies these baseline HTTP protections:

- Express X-Powered-By is disabled.
- API responses use Cache-Control: no-store.
- X-Content-Type-Options is nosniff.
- X-Frame-Options is DENY.
- Referrer-Policy is no-referrer.
- Camera and geolocation are disabled through Permissions-Policy.
- JSON request bodies are capped at 16 KB.
- Oversized or invalid JSON returns a short JSON error rather than parser
  diagnostics.
- AssemblyAI token-mint failures do not log the upstream response body.

## Deliberate current blocker: loopback binding

server.js still binds to 127.0.0.1.

Do **not** change that to 0.0.0.0 merely to make a deployment work. A public
binding changes the threat model and must be paired with a deliberate decision
for public token-mint abuse controls, proxy/origin handling, HTTPS termination,
and deployment-platform behavior.

Until that work is complete, HOSTED_DEMO means “hosted-safe capability
surface,” not “production-ready public deployment.”

## Public deployment decisions still required

Before exposing Offscreen publicly, decide and verify all of the following:

1. **Token endpoint abuse controls**
   - /api/voice-token mints temporary AssemblyAI credentials.
   - Choose a rate-limit/access strategy appropriate to the actual hosting
     platform.
   - Do not trust forwarded IP headers until the platform/proxy topology is
     known.

2. **Host and proxy configuration**
   - Choose the platform.
   - Define the exact bind address and trusted proxy behavior.
   - Keep LOCAL development loopback-only.

3. **HTTPS**
   - Microphone and modern browser APIs require a secure context outside
     localhost.
   - Verify HTTPS is enforced by the chosen platform.

4. **Origin policy**
   - Decide whether the hosted demo needs an explicit allowed-origin policy.
   - Do not add permissive CORS as a shortcut.

5. **Content Security Policy**
   - Add CSP only after verifying the exact AssemblyAI Voice Agent WebSocket
     and frontend resource requirements.
   - Do not ship a guessed policy that silently breaks voice connectivity.

6. **Secrets**
   - ASSEMBLYAI_API_KEY must be provided only through the hosting platform's
     server-side secret/environment system.
   - Never expose .env, credentials.json, token.json, Codex auth, or Google
     OAuth files in a hosted image.

7. **Capability claims**
   - Hosted mode currently provides voice conversation and hosted-safe
     browser-only features such as supported-site opening.
   - Do not claim LOCAL Calendar, Codex, developer workspace, or controlled
     Playwright browser features are available publicly.

## Pre-deployment verification

Before changing the bind address:

- npm test passes in GitHub Actions.
- git diff --check passes.
- HOSTED_DEMO route tests confirm local-only APIs are absent.
- HTTP security-header tests pass.
- Invalid and oversized JSON return normalized errors.
- The public deployment plan documents token rate limiting and trusted proxy
  behavior.

After deploying to a chosen platform:

- verify the application URL over HTTPS;
- verify /api/capabilities.js returns hosted-safe capabilities and no-store;
- verify local-only /api routes return 404;
- verify the temporary-token route works without exposing the AssemblyAI API
  key;
- test a real microphone session in the deployed browser;
- test reconnect and token refresh behavior;
- inspect response headers from the public URL;
- verify no repository secret files are present in the deployment artifact.

## Not part of this preflight

This preflight does not:

- bind the server publicly;
- choose a cloud provider;
- add permissive CORS;
- add a guessed CSP;
- add Gmail or Calendar permissions;
- expose local developer tools;
- claim production readiness.
