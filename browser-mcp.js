import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const MAX_URL_CHARACTERS = 2_048;
const MAX_FIND_TEXT_CHARACTERS = 512;
const MAX_BROWSER_OUTPUT_CHARACTERS = 12_000;

export const BROWSER_MCP_ACTIONS = Object.freeze({
  navigate: { toolName: "browser_navigate" },
  snapshot: { toolName: "browser_snapshot" },
  find: { toolName: "browser_find" },
  back: { toolName: "browser_navigate_back" },
});

const require = createRequire(import.meta.url);
const mcpRequire = createRequire(require.resolve("@playwright/mcp/package.json"));
const { chromium } = mcpRequire("playwright");
const playwrightMcpCliPath = join(
  dirname(require.resolve("@playwright/mcp/package.json")),
  "cli.js"
);

function createDefaultClient() {
  return new Client({ name: "offscreen-browser", version: "1.0.0" });
}

function createDefaultTransport() {
  return new StdioClientTransport({
    command: process.execPath,
    args: [
      playwrightMcpCliPath,
      "--headless",
      "--isolated",
      "--executable-path",
      chromium.executablePath(),
    ],
    stderr: "ignore",
  });
}

function getNavigationUrl(url) {
  if (typeof url !== "string" || url.length > MAX_URL_CHARACTERS) {
    return null;
  }

  const trimmedUrl = url.trim();

  if (!trimmedUrl) {
    return null;
  }

  const hasHttpScheme = /^https?:\/\//i.test(trimmedUrl);
  const normalizedUrl = hasHttpScheme
    ? trimmedUrl
    : `https://${trimmedUrl}`;

  try {
    const parsedUrl = new URL(normalizedUrl);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }

    if (!hasHttpScheme && !isPlainDomain(trimmedUrl)) {
      return null;
    }

    return normalizedUrl;
  } catch {
    return null;
  }
}

function isPlainDomain(value) {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#][^\s]*)?$/i.test(
    value
  );
}

function getFindText(text) {
  if (typeof text !== "string") {
    return null;
  }

  const trimmedText = text.trim();

  if (!trimmedText || trimmedText.length > MAX_FIND_TEXT_CHARACTERS) {
    return null;
  }

  return trimmedText;
}

export function validateBrowserRequest(action, input = {}) {
  if (!BROWSER_MCP_ACTIONS[action]) {
    return { success: false, error: "Unsupported browser action" };
  }

  if (action === "navigate") {
    const url = getNavigationUrl(input.url);

    if (!url) {
      return {
        success: false,
        error: "Browser navigation requires an http or https URL",
      };
    }

    return { success: true, arguments: { url } };
  }

  if (action === "find") {
    const text = getFindText(input.text);

    if (!text) {
      return { success: false, error: "Browser find text is required" };
    }

    return { success: true, arguments: { text } };
  }

  return { success: true, arguments: {} };
}

function getBoundedText(mcpResult) {
  const text = (mcpResult.content || [])
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");

  return text.slice(0, MAX_BROWSER_OUTPUT_CHARACTERS);
}

export function createBrowserMcp({
  createClient = createDefaultClient,
  createTransport = createDefaultTransport,
} = {}) {
  let client;
  let connectionPromise;

  async function getConnectedClient() {
    if (connectionPromise) {
      return connectionPromise;
    }

    connectionPromise = (async () => {
      client = createClient();
      await client.connect(createTransport());

      const { tools } = await client.listTools();
      const availableToolNames = new Set(tools.map((tool) => tool.name));

      for (const { toolName } of Object.values(BROWSER_MCP_ACTIONS)) {
        if (!availableToolNames.has(toolName)) {
          throw new Error("Required Playwright MCP tools are unavailable");
        }
      }

      return client;
    })();

    try {
      return await connectionPromise;
    } catch (error) {
      connectionPromise = null;
      client = null;
      throw error;
    }
  }

  async function run(action, input = {}) {
    const validation = validateBrowserRequest(action, input);

    if (!validation.success) {
      return validation;
    }

    try {
      const connectedClient = await getConnectedClient();
      const result = await connectedClient.callTool({
        name: BROWSER_MCP_ACTIONS[action].toolName,
        arguments: validation.arguments,
      });

      if (result.isError) {
        return { success: false, error: "Browser action failed" };
      }

      return {
        success: true,
        content: getBoundedText(result),
      };
    } catch {
      console.error(`Browser MCP ${action} failed`);
      return { success: false, error: "Browser action failed" };
    }
  }

  return { run };
}

const browserMcp = createBrowserMcp();

export function runBrowserAction(action, input) {
  return browserMcp.run(action, input);
}
