import assert from "node:assert/strict";
import test from "node:test";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static instances = [];
  constructor() { this.readyState = FakeWebSocket.CONNECTING; this.sentMessages = []; FakeWebSocket.instances.push(this); }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  receive(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
  send(message) { this.sentMessages.push(JSON.parse(message)); }
}

function createElement() {
  return {
    addEventListener(type, listener) { this.listeners ??= {}; this.listeners[type] = listener; },
    appendChild(child) { child.parentNode = this; this.children ??= []; this.children.push(child); return child; },
    children: [], classList: { remove() {} }, disabled: false, hidden: true, parentNode: null,
    remove() {}, scrollHeight: 0, scrollTop: 0, textContent: "", value: "",
  };
}

async function flushPromises() { await new Promise((resolve) => setImmediate(resolve)); }

function completeAgentReply(socket, text) {
  socket.receive({ type: "reply.started" });
  socket.receive({ type: "transcript.agent", text });
  socket.receive({ type: "reply.done", status: "completed" });
}

test("binds contextual ordinals to spoken search paths and keeps the list after opening one", async () => {
  const originals = {
    fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, document: globalThis.document,
    window: globalThis.window, navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    AudioWorkletNode: globalThis.AudioWorkletNode, capabilities: globalThis.__OFFSCREEN_CAPABILITIES__,
  };
  const requests = [];

  try {
    FakeWebSocket.instances = [];
    const elements = new Map();
    for (const id of ["connect", "disconnect", "voice-wake", "resume-listening", "clear", "voice", "prompt", "greeting", "transcript", "empty", "status-dot", "status-text", "hosted-demo-notice"]) elements.set(id, createElement());
    elements.get("empty").parentNode = elements.get("transcript");
    globalThis.document = { createElement, getElementById: (id) => elements.get(id) };
    globalThis.window = { AudioContext: class { constructor() { this.audioWorklet = { addModule: async () => {} }; this.currentTime = 0; } close() {} createMediaStreamSource() { return { connect() {}, disconnect() {} }; } } };
    globalThis.AudioWorkletNode = class { constructor() { this.port = {}; } disconnect() {} };
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } } });
    globalThis.WebSocket = FakeWebSocket;
    globalThis.__OFFSCREEN_CAPABILITIES__ = { isHostedDemo: false, calendar: true, codex: true, developerWorkspace: true, browserControl: true };
    globalThis.fetch = async (url, options) => {
      if (url === "/api/voice-token") return { ok: true, json: async () => ({ token: "test-token" }) };
      const body = options?.body ? JSON.parse(options.body) : undefined;
      requests.push({ url, body });
      if (url === "/api/developer/search") return { ok: true, json: async () => ({
        success: true,
        query: "run project tests",
        matches: [
          { path: "public/app.js", line: 20, snippet: "runProjectTests" },
          { path: "public/project-tests-tool.js", line: 1, snippet: "runProjectTests" },
          { path: "public/tools.js", line: 1, snippet: "run project tests" },
          { path: "test/hidden-from-presentation.test.js", line: 5, snippet: "runProjectTests" },
        ],
        files: [
          { path: "public/app.js", firstLine: 20 },
          { path: "public/project-tests-tool.js", firstLine: 1 },
          { path: "public/tools.js", firstLine: 1 },
          { path: "test/hidden-from-presentation.test.js", firstLine: 5 },
        ],
        presentation: { files: [
          { position: 1, path: "public/app.js" },
          { position: 2, path: "public/project-tests-tool.js" },
          { position: 3, path: "public/tools.js" },
        ], truncated: true },
      }) };
      if (url === "/api/developer/open-file") return { ok: true, json: async () => ({
        success: true,
        path: body.path,
        ...(body.line === undefined ? {} : { line: body.line }),
      }) };
      if (url === "/api/developer/git-diff") {
        if (body?.path === ".env") {
          return { ok: false, json: async () => ({ success: false, error: "path_denied", terminal: true }) };
        }

        return { ok: true, json: async () => ({
          success: true,
          files: [
            { path: "public/app.js", unstaged: { hunks: [] } },
            { path: "public/tools.js", unstaged: { hunks: [] } },
            { path: "server.js", unstaged: { hunks: [] } },
            { path: "test/git-diff.test.js", unstaged: { hunks: [] } },
          ],
          presentation: { files: [
            { position: 1, path: "public/app.js" },
            { position: 2, path: "public/tools.js" },
            { position: 3, path: "server.js" },
          ], truncated: true },
          truncated: true,
        }) };
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    await import(`../public/app.js?project-reference-test=${Date.now()}`);
    await elements.get("connect").listeners.click();
    const socket = FakeWebSocket.instances.at(-1);
    socket.open();
    socket.receive({ type: "session.ready", session_id: "project-reference" });

    socket.receive({ type: "transcript.user", text: "Search the project for run project tests." });
    socket.receive({ type: "reply.started" });
    socket.receive({ type: "transcript.agent", text: "I'll search the project for that." });
    socket.receive({ type: "tool.call", name: "search_project", call_id: "search", arguments: { query: "run project tests" } });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    const searchToolResultMessage = socket.sentMessages.find((message) =>
      message.type === "tool.result" && message.call_id === "search"
    );
    const searchToolResult = JSON.parse(searchToolResultMessage.result);
    assert.deepEqual(searchToolResult.files, [
      { path: "public/app.js" },
      { path: "public/project-tests-tool.js" },
      { path: "public/tools.js" },
    ]);
    assert.equal(
      searchToolResult.matches.some((match) => match.path === "test/hidden-from-presentation.test.js"),
      false
    );

    // AssemblyAI is free to summarize/reorder the bounded candidates. Context
    // must follow the paths the user actually heard, not the hidden canonical order.
    completeAgentReply(
      socket,
      "The most relevant files seem to be public/project-tests-tool.js, public/app.js, and public/tools.js."
    );

    socket.receive({ type: "transcript.user", text: "Open the fourth one." });
    socket.receive({ type: "tool.call", name: "open_project_file", call_id: "out-of-range", arguments: { path: "fourth one" } });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();
    assert.deepEqual(requests, [
      { url: "/api/developer/search", body: { query: "run project tests" } },
    ]);

    socket.receive({ type: "transcript.user", text: "Open the second one." });
    socket.receive({ type: "tool.call", name: "open_project_file", call_id: "second", arguments: { path: "second one", line: 20 } });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    socket.receive({ type: "transcript.user", text: "Open it at line 120." });
    socket.receive({ type: "tool.call", name: "open_project_file", call_id: "line", arguments: { path: "that file" } });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    socket.receive({ type: "transcript.user", text: "Open the third one." });
    socket.receive({ type: "tool.call", name: "open_project_file", call_id: "third", arguments: { path: "third one" } });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    assert.deepEqual(requests, [
      { url: "/api/developer/search", body: { query: "run project tests" } },
      { url: "/api/developer/open-file", body: { path: "public/app.js" } },
      { url: "/api/developer/open-file", body: { path: "public/app.js", line: 120 } },
      { url: "/api/developer/open-file", body: { path: "public/tools.js" } },
    ]);

    socket.receive({ type: "transcript.user", text: "What changed?" });
    socket.receive({ type: "reply.started" });
    socket.receive({ type: "tool.call", name: "get_git_diff", call_id: "broad-diff", arguments: {} });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();
    completeAgentReply(socket, "The first changed files are public/app.js, public/tools.js, and server.js.");

    socket.receive({ type: "transcript.user", text: "Open the second changed file." });
    socket.receive({ type: "tool.call", name: "open_project_file", call_id: "second-changed", arguments: { path: "second changed file" } });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    socket.receive({ type: "transcript.user", text: "Open the fourth changed file." });
    socket.receive({ type: "tool.call", name: "open_project_file", call_id: "hidden-changed", arguments: { path: "fourth changed file" } });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    socket.receive({ type: "transcript.user", text: "What changed in .env?" });
    socket.receive({ type: "tool.call", name: "get_git_diff", call_id: "denied-diff", arguments: { path: ".env" } });
    socket.receive({ type: "tool.call", name: "get_git_diff", call_id: "denied-diff-retry", arguments: { path: ".env" } });
    socket.receive({ type: "reply.done", status: "completed" });
    await flushPromises();

    assert.deepEqual(requests.slice(-3), [
      { url: "/api/developer/git-diff", body: undefined },
      { url: "/api/developer/open-file", body: { path: "public/tools.js" } },
      { url: "/api/developer/git-diff", body: { path: ".env" } },
    ]);
    const deniedResult = socket.sentMessages.find((message) => (
      message.type === "tool.result" && message.call_id === "denied-diff"
    ));
    assert.deepEqual(JSON.parse(deniedResult.result), {
      success: false,
      error: "path_denied",
      terminal: true,
    });
  } finally {
    globalThis.fetch = originals.fetch; globalThis.WebSocket = originals.WebSocket;
    globalThis.document = originals.document; globalThis.window = originals.window;
    if (originals.navigator) Object.defineProperty(globalThis, "navigator", originals.navigator);
    else delete globalThis.navigator;
    globalThis.AudioWorkletNode = originals.AudioWorkletNode;
    globalThis.__OFFSCREEN_CAPABILITIES__ = originals.capabilities;
  }
});
