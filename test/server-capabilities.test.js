import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../server.js";

function createTestApp(mode) {
  return createApp({
    apiKey: "test-key",
    mode,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ token: "test-token" }),
    }),
  });
}

function getRegisteredApiRoutes(app) {
  return app._router.stack
    .filter((layer) => layer.route?.path.startsWith("/api/"))
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods).sort(),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

test("LOCAL registers every current backend capability route", () => {
  const app = createTestApp("LOCAL");

  assert.deepEqual(getRegisteredApiRoutes(app), [
    { path: "/api/browser", methods: ["post"] },
    { path: "/api/calendar/date", methods: ["get"] },
    { path: "/api/calendar/events", methods: ["get"] },
    { path: "/api/calendar/query", methods: ["get"] },
    { path: "/api/capabilities.js", methods: ["get"] },
    { path: "/api/codex", methods: ["post"] },
    { path: "/api/developer/git-status", methods: ["post"] },
    { path: "/api/voice-token", methods: ["get"] },
  ]);
});

test("HOSTED_DEMO leaves local-only routes unregistered", () => {
  const app = createTestApp("HOSTED_DEMO");

  assert.deepEqual(getRegisteredApiRoutes(app), [
    { path: "/api/capabilities.js", methods: ["get"] },
    { path: "/api/voice-token", methods: ["get"] },
  ]);
});

test("an invalid explicit mode fails before LOCAL routes can register", () => {
  assert.throws(
    () => createTestApp("HOSTED_DEMO "),
    /Invalid OFFSCREEN_MODE/
  );
});

test("client capability data cannot enable hosted routes", () => {
  const app = createTestApp("HOSTED_DEMO");

  assert.deepEqual(getRegisteredApiRoutes(app), [
    { path: "/api/capabilities.js", methods: ["get"] },
    { path: "/api/voice-token", methods: ["get"] },
  ]);

  const capabilityLayer = app._router.stack.find(
    (layer) => layer.route?.path === "/api/capabilities.js"
  );
  const response = {
    type() { return this; },
    set(name, value) { this.headers[name] = value; return this; },
    headers: {},
    send(value) { this.value = value; },
  };

  capabilityLayer.route.stack[0].handle(
    { query: { mode: "LOCAL" }, body: { browserControl: true } },
    response
  );

  assert.match(response.value, /isHostedDemo":true/);
  assert.doesNotMatch(response.value, /browserControl":true/);
  assert.doesNotMatch(response.value, /developerWorkspace":true/);
  assert.equal(response.headers["Cache-Control"], "no-store");
});

test("Git status route uses only the configured project root and ignores request input", async () => {
  const calls = [];
  const app = createApp({
    apiKey: "test-key",
    mode: "LOCAL",
    fetchImpl: async () => ({ ok: true, json: async () => ({ token: "test-token" }) }),
    gitStatusImpl: async (options) => {
      calls.push(options);
      return { success: true, branch: "main", clean: true, staged: [], unstaged: [], untracked: [], summary: "Working tree is clean on main." };
    },
  });
  const route = app._router.stack.find(
    (layer) => layer.route?.path === "/api/developer/git-status"
  );
  const response = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; },
  };

  await route.route.stack[0].handle(
    { body: { command: "git reset --hard", path: "../elsewhere" } },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0].projectRoot, /offscreen$/);
});
