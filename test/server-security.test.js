import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../server.js";

async function listen(app) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        baseUrl: "http://127.0.0.1:" + address.port,
      });
    });
    server.on("error", reject);
  });
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test("serves conservative security headers and no-store API responses", async () => {
  const app = createApp({
    apiKey: "test-key",
    mode: "HOSTED_DEMO",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ token: "temporary-token" }),
    }),
  });

  const { server, baseUrl } = await listen(app);

  try {
    const capabilities = await fetch(baseUrl + "/api/capabilities.js");

    assert.equal(capabilities.status, 200);
    assert.equal(capabilities.headers.get("cache-control"), "no-store");
    assert.equal(capabilities.headers.get("x-content-type-options"), "nosniff");
    assert.equal(capabilities.headers.get("x-frame-options"), "DENY");
    assert.equal(capabilities.headers.get("referrer-policy"), "no-referrer");
    assert.equal(
      capabilities.headers.get("permissions-policy"),
      "camera=(), geolocation=()"
    );
    assert.equal(capabilities.headers.get("x-powered-by"), null);

    const token = await fetch(baseUrl + "/api/voice-token");

    assert.equal(token.status, 200);
    assert.equal(token.headers.get("cache-control"), "no-store");
    assert.equal(token.headers.get("x-content-type-options"), "nosniff");
    assert.equal(token.headers.get("x-powered-by"), null);
  } finally {
    await close(server);
  }
});

test("rejects oversized JSON before a local tool route can execute", async () => {
  let codexFetchCalls = 0;
  const app = createApp({
    apiKey: "test-key",
    mode: "LOCAL",
    fetchImpl: async () => {
      codexFetchCalls++;
      return {
        ok: true,
        json: async () => ({ token: "temporary-token" }),
      };
    },
  });

  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(baseUrl + "/api/codex", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task: "x".repeat(20 * 1024),
      }),
    });

    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), {
      error: "Request body is too large",
    });
    assert.equal(codexFetchCalls, 0);
  } finally {
    await close(server);
  }
});


test("normalizes invalid JSON without exposing parser diagnostics", async () => {
  const app = createApp({
    apiKey: "test-key",
    mode: "HOSTED_DEMO",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ token: "temporary-token" }),
    }),
  });

  const { server, baseUrl } = await listen(app);

  try {
    const response = await fetch(baseUrl + "/api/voice-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: "{not-valid-json",
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Invalid JSON request body",
    });
  } finally {
    await close(server);
  }
});
