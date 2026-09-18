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
        : { content: [{ type: "text", text: '- link "Example" [ref=e5]' }] };
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

test("accepts only refs observed in the latest snapshot or find output", async () => {
  const client = createFakeClient({
    callTool: async (request) => {
      if (request.name === "browser_snapshot") {
        return {
          content: [{ type: "text", text: '- textbox "Search" [ref=e5]' }],
        };
      }

      return { content: [{ type: "text", text: "Done" }] };
    },
  });
  const browserMcp = createBrowserMcp({
    createClient: () => client,
    createTransport: () => ({}),
  });

  await browserMcp.run("snapshot");
  assert.equal((await browserMcp.run("click", { target: "e5" })).success, true);
  assert.deepEqual(await browserMcp.run("type", { target: "e5", text: "test" }), {
    success: false,
    error: "Browser target must be a ref from the latest page read or find result",
  });
  assert.deepEqual(await browserMcp.run("click", { target: "button.search" }), {
    success: false,
    error: "Browser target must be a ref from the latest page read or find result",
  });
});

test("updates observed refs from find output and always types without submitting", async () => {
  const client = createFakeClient({
    callTool: async (request) => {
      if (request.name === "browser_find") {
        return {
          content: [{ type: "text", text: '- textbox "Search" [ref=e9]' }],
        };
      }

      return { content: [{ type: "text", text: "Done" }] };
    },
  });
  const browserMcp = createBrowserMcp({
    createClient: () => client,
    createTransport: () => ({}),
  });

  await browserMcp.run("find", { text: "Search" });
  const result = await browserMcp.run("type", {
    target: "e9",
    text: "AssemblyAI",
    element: "Wikipedia search box",
  });

  assert.equal(result.success, true);
  assert.deepEqual(client.callToolCalls.at(-1), {
    name: "browser_type",
    arguments: {
      target: "e9",
      text: "AssemblyAI",
      element: "Wikipedia search box",
      submit: false,
      slowly: false,
    },
  });
});

test("accepts Playwright refs with a navigation prefix", async () => {
  const client = createFakeClient({
    callTool: async (request) => {
      if (request.name === "browser_snapshot") {
        return {
          content: [{ type: "text", text: '- searchbox "Search" [ref=f1e23]' }],
        };
      }

      return { content: [{ type: "text", text: "Done" }] };
    },
  });
  const browserMcp = createBrowserMcp({
    createClient: () => client,
    createTransport: () => ({}),
  });

  await browserMcp.run("snapshot");
  assert.equal(
    (await browserMcp.run("type", { target: "f1e23", text: "AssemblyAI" })).success,
    true
  );
});

test("rejects browser type for an observed non-editable target", async () => {
  const client = createFakeClient({
    callTool: async (request) => {
      if (request.name === "browser_snapshot") {
        return {
          content: [{ type: "text", text: '- button "Search" [ref=e25]' }],
        };
      }

      return { content: [{ type: "text", text: "Done" }] };
    },
  });
  const browserMcp = createBrowserMcp({
    createClient: () => client,
    createTransport: () => ({}),
  });

  await browserMcp.run("snapshot");
  assert.deepEqual(await browserMcp.run("type", { target: "e25", text: "AssemblyAI" }), {
    success: false,
    error: "Browser type target is not editable. Read or find the page again to locate an editable field.",
    errorCode: "browser_target_not_editable",
  });
  assert.equal(client.callToolCalls.length, 1);
});

test("invalidates refs and requests a refresh after a stale click failure", async () => {
  const client = createFakeClient({
    callTool: async (request) => {
      if (request.name === "browser_snapshot") {
        return {
          content: [{ type: "text", text: '- link "English" [ref=e9]' }],
        };
      }

      if (request.name === "browser_click") {
        return {
          isError: true,
          content: [{ type: "text", text: "Error: Ref e9 not found in the current page snapshot. Try capturing new snapshot." }],
        };
      }

      return { content: [{ type: "text", text: "Done" }] };
    },
  });
  const browserMcp = createBrowserMcp({
    createClient: () => client,
    createTransport: () => ({}),
  });

  await browserMcp.run("snapshot");
  assert.deepEqual(await browserMcp.run("click", { target: "e9" }), {
    success: false,
    error: "Browser page changed. Read or find the page again before trying this interaction.",
    errorCode: "browser_ref_stale",
  });
  assert.deepEqual(await browserMcp.run("click", { target: "e9" }), {
    success: false,
    error: "Browser target must be a ref from the latest page read or find result",
  });
});

test("invalidates refs after a stale type failure and after successful typing", async () => {
  let snapshotCount = 0;
  const client = createFakeClient({
    callTool: async (request) => {
      if (request.name === "browser_snapshot") {
        snapshotCount++;
        return {
          content: [{ type: "text", text: '- searchbox "Search" [ref=e53]' }],
        };
      }

      if (request.name === "browser_type" && snapshotCount === 1) {
        return {
          isError: true,
          content: [{ type: "text", text: "Error: Ref e53 not found in the current page snapshot. Try capturing new snapshot." }],
        };
      }

      return { content: [{ type: "text", text: "Done" }] };
    },
  });
  const browserMcp = createBrowserMcp({
    createClient: () => client,
    createTransport: () => ({}),
  });

  await browserMcp.run("snapshot");
  assert.deepEqual(await browserMcp.run("type", { target: "e53", text: "AssemblyAI" }), {
    success: false,
    error: "Browser page changed. Read or find the page again before trying this interaction.",
    errorCode: "browser_ref_stale",
  });
  assert.deepEqual(await browserMcp.run("type", { target: "e53", text: "AssemblyAI" }), {
    success: false,
    error: "Browser target must be a ref from the latest page read or find result",
  });

  await browserMcp.run("snapshot");
  assert.equal((await browserMcp.run("type", { target: "e53", text: "AssemblyAI" })).success, true);
  assert.deepEqual(await browserMcp.run("type", { target: "e53", text: "AssemblyAI" }), {
    success: false,
    error: "Browser target must be a ref from the latest page read or find result",
  });
});

test("rejects type text that exceeds the safe limit", () => {
  assert.deepEqual(validateBrowserRequest("type", {
    target: "e5",
    text: "x".repeat(2_001),
  }), {
    success: false,
    error: "Browser type text is too long",
  });
});

test("rejects consequential click targets before calling MCP", async () => {
  const client = createFakeClient({
    callTool: async (request) => {
      if (request.name === "browser_snapshot") {
        return {
          content: [{ type: "text", text: '- button "Delete account" [ref=e12]' }],
        };
      }

      return { content: [{ type: "text", text: "Done" }] };
    },
  });
  const browserMcp = createBrowserMcp({
    createClient: () => client,
    createTransport: () => ({}),
  });

  await browserMcp.run("snapshot");
  assert.deepEqual(await browserMcp.run("click", { target: "e12" }), {
    success: false,
    error: "This browser action requires confirmation support, which is not enabled yet.",
  });
  assert.equal(client.callToolCalls.length, 1);
});

test("rejects unsupported browser actions without contacting MCP", async () => {
  const client = createFakeClient();
  const browserMcp = createBrowserMcp({
    createClient: () => client,
    createTransport: () => ({}),
  });

  assert.deepEqual(await browserMcp.run("drag", { target: "e1" }), {
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
