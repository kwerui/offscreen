import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_MCP_ACTIONS,
  createBrowserMcp,
  validateBrowserRequest,
} from "../browser-mcp.js";

function createFakeClient({ tools, callTool } = {}) {
  return {
    connectCalls: 0,
    listToolsCalls: 0,
    callToolCalls: [],
    async connect() {
      this.connectCalls++;
    },
    async listTools() {
      this.listToolsCalls++;
      return {
        tools: tools || Object.values(BROWSER_MCP_ACTIONS).map(
          ({ toolName }) => ({ name: toolName })
        ),
      };
    },
    async callTool(request) {
      this.callToolCalls.push(request);
      return callTool
        ? callTool(request)
        : { content: [{ type: "text", text: "Page content" }] };
    },
  };
}

test("maps only allowed Offscreen actions to Playwright MCP tools", async () => {
  const client = createFakeClient();
  const browserMcp = createBrowserMcp({
    createClient: () => client,
    createTransport: () => ({}),
  });

  const cases = [
    ["navigate", { url: "https://example.com" }, "browser_navigate"],
    ["snapshot", {}, "browser_snapshot"],
    ["find", { text: "Example" }, "browser_find"],
    ["back", {}, "browser_navigate_back"],
  ];

  for (const [action, arguments_, toolName] of cases) {
    const result = await browserMcp.run(action, arguments_);
    assert.equal(result.success, true);
    assert.equal(client.callToolCalls.at(-1).name, toolName);
  }
});

test("rejects unsupported browser actions without contacting MCP", async () => {
  const client = createFakeClient();
  const browserMcp = createBrowserMcp({
    createClient: () => client,
    createTransport: () => ({}),
  });

  assert.deepEqual(await browserMcp.run("click", { target: "e1" }), {
    success: false,
    error: "Unsupported browser action",
  });
  assert.equal(client.connectCalls, 0);
});

test("starts Playwright MCP lazily and reuses its connection", async () => {
  let clientCount = 0;
  const client = createFakeClient();
  const browserMcp = createBrowserMcp({
    createClient: () => {
      clientCount++;
      return client;
    },
    createTransport: () => ({}),
  });

  assert.equal(clientCount, 0);
  await browserMcp.run("snapshot", {});
  await browserMcp.run("back", {});

  assert.equal(clientCount, 1);
  assert.equal(client.connectCalls, 1);
  assert.equal(client.listToolsCalls, 1);
});

test("normalizes MCP failures without returning upstream details", async () => {
  const client = createFakeClient({
    callTool: async () => {
      throw new Error("MCP server leaked a page-specific detail");
    },
  });
  const browserMcp = createBrowserMcp({
    createClient: () => client,
    createTransport: () => ({}),
  });

  assert.deepEqual(await browserMcp.run("snapshot", {}), {
    success: false,
    error: "Browser action failed",
  });
});

test("bounds browser output before it reaches the voice tool", async () => {
  const client = createFakeClient({
    callTool: async () => ({
      content: [{ type: "text", text: "x".repeat(20_000) }],
    }),
  });
  const browserMcp = createBrowserMcp({
    createClient: () => client,
    createTransport: () => ({}),
  });

  const result = await browserMcp.run("snapshot", {});
  assert.equal(result.success, true);
  assert.equal(result.content.length, 12_000);
});

test("rejects navigation outside explicit http and https URLs", () => {
  const disallowedUrls = [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "chrome://settings",
    "ftp://example.com",
    "not a url",
    "https:example.com",
  ];

  for (const url of disallowedUrls) {
    assert.deepEqual(validateBrowserRequest("navigate", { url }), {
      success: false,
      error: "Browser navigation requires an http or https URL",
    });
  }
});

test("normalizes a plain domain to an https URL", () => {
  assert.deepEqual(validateBrowserRequest("navigate", { url: "example.com" }), {
    success: true,
    arguments: { url: "https://example.com" },
  });
});

test("normalizes a www domain to an https URL", () => {
  assert.deepEqual(
    validateBrowserRequest("navigate", { url: "www.example.com" }),
    {
      success: true,
      arguments: { url: "https://www.example.com" },
    }
  );
});

test("preserves already-valid http and https URLs", () => {
  assert.deepEqual(
    validateBrowserRequest("navigate", { url: "http://example.com/path" }),
    { success: true, arguments: { url: "http://example.com/path" } }
  );
  assert.deepEqual(
    validateBrowserRequest("navigate", { url: "https://example.com/path" }),
    { success: true, arguments: { url: "https://example.com/path" } }
  );
});
