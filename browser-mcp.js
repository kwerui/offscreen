import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const MAX_URL_CHARACTERS = 2_048;
const MAX_FIND_TEXT_CHARACTERS = 512;
const MAX_ELEMENT_DESCRIPTION_CHARACTERS = 512;
const MAX_TYPE_TEXT_CHARACTERS = 2_000;
const MAX_BROWSER_OUTPUT_CHARACTERS = 12_000;
const CONFIRMATION_REQUIRED_ERROR =
  "This browser action requires confirmation support, which is not enabled yet.";
const OBSERVED_REF_ERROR =
  "Browser target must be a ref from the latest page read or find result";
const STALE_REF_ERROR =
  "Browser page changed. Read or find the page again before trying this interaction.";
const NON_EDITABLE_TARGET_ERROR =
  "Browser type target is not editable. Read or find the page again to locate an editable field.";
const CONSEQUENTIAL_CLICK_PATTERN =
  /\b(delete|remove|purchase|buy|checkout|pay|donate|send|submit|publish|place order|authorize|confirm)\b/i;

export const BROWSER_MCP_ACTIONS = Object.freeze({
  navigate: { toolName: "browser_navigate" },
  snapshot: { toolName: "browser_snapshot" },
  find: { toolName: "browser_find" },
  back: { toolName: "browser_navigate_back" },
  click: { toolName: "browser_click" },
  type: { toolName: "browser_type" },
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

function getElementDescription(element) {
  if (element === undefined) {
    return undefined;
  }

  if (typeof element !== "string") {
    return null;
  }

  const trimmedElement = element.trim();

  if (!trimmedElement || trimmedElement.length > MAX_ELEMENT_DESCRIPTION_CHARACTERS) {
    return null;
  }

  return trimmedElement;
}

function getTarget(target) {
  if (
    typeof target !== "string" ||
    !/^(?:e\d+|[a-z][a-z0-9]*e\d+)$/.test(target)
  ) {
    return null;
  }

  return target;
}

function getTypeText(text) {
  if (typeof text !== "string" || !text || text.length > MAX_TYPE_TEXT_CHARACTERS) {
    return null;
  }

  return text;
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

  if (action === "click" || action === "type") {
    const target = getTarget(input.target);
    const element = getElementDescription(input.element);

    if (!target) {
      return { success: false, error: OBSERVED_REF_ERROR };
    }

    if (element === null) {
      return { success: false, error: "Browser element description is invalid" };
    }

    const arguments_ = { target };

    if (element) {
      arguments_.element = element;
    }

    if (action === "type") {
      const text = getTypeText(input.text);

      if (!text) {
        return {
          success: false,
          error:
            typeof input.text === "string" && input.text.length > MAX_TYPE_TEXT_CHARACTERS
              ? "Browser type text is too long"
              : "Browser type text is required",
        };
      }

      return {
        success: true,
        arguments: { ...arguments_, text, submit: false, slowly: false },
      };
    }

    return { success: true, arguments: arguments_ };
  }

  return { success: true, arguments: {} };
}

function getObservedRefs(content) {
  const observedRefs = new Map();

  for (const line of content.split("\n")) {
    for (const match of line.matchAll(/\[ref=((?:e\d+|[a-z][a-z0-9]*e\d+))\]/g)) {
      observedRefs.set(match[1], line);
    }
  }

  return observedRefs;
}

function isEditableTargetDescription(description) {
  return /\b(searchbox|textbox|input|textarea)\b|\[contenteditable(?:=[^\]]*)?\]/i.test(
    description
  );
}

function getMcpResultText(mcpResult) {
  return (mcpResult.content || [])
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function isStaleRefError(errorText) {
  return /\b(ref|element)\b[\s\S]{0,160}\b(stale|detached|not found|missing|no longer valid)\b/i.test(
    errorText
  );
}

function getBoundedText(mcpResult) {
  return getMcpResultText(mcpResult).slice(0, MAX_BROWSER_OUTPUT_CHARACTERS);
}

export function createBrowserMcp({
  createClient = createDefaultClient,
  createTransport = createDefaultTransport,
} = {}) {
  let client;
  let connectionPromise;
  let observedRefs = new Map();

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

    if ((action === "click" || action === "type") && !observedRefs.has(validation.arguments.target)) {
      return { success: false, error: OBSERVED_REF_ERROR };
    }

    if (action === "click") {
      const observedDescription = observedRefs.get(validation.arguments.target);

      if (CONSEQUENTIAL_CLICK_PATTERN.test(observedDescription)) {
        return { success: false, error: CONFIRMATION_REQUIRED_ERROR };
      }
    }

    if (action === "type") {
      const observedDescription = observedRefs.get(validation.arguments.target);

      if (!isEditableTargetDescription(observedDescription)) {
        return {
          success: false,
          error: NON_EDITABLE_TARGET_ERROR,
          errorCode: "browser_target_not_editable",
        };
      }
    }

    // Page-changing actions can invalidate refs even when Playwright reports an error.
    if (action === "navigate" || action === "back" || action === "click") {
      observedRefs = new Map();
    }

    try {
      const connectedClient = await getConnectedClient();
      const result = await connectedClient.callTool({
        name: BROWSER_MCP_ACTIONS[action].toolName,
        arguments: validation.arguments,
      });

      if (result.isError) {
        if (action === "click" || action === "type") {
          observedRefs = new Map();
          const errorText = getMcpResultText(result);
          const errorCode = isStaleRefError(errorText)
            ? "browser_ref_stale"
            : "browser_interaction_failed";

          console.error(`Browser MCP ${action} rejected: ${errorCode}`);
          return {
            success: false,
            error: STALE_REF_ERROR,
            errorCode,
          };
        }

        return { success: false, error: "Browser action failed" };
      }

      const content = getBoundedText(result);

      if (action === "snapshot" || action === "find") {
        observedRefs = getObservedRefs(content);
      }

      if (action === "type") {
        observedRefs = new Map();
      }

      return {
        success: true,
        content,
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
