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
  assert.equal(response.headers["Cache-Control"], "no-store");
});
