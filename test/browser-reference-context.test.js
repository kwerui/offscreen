import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserReferenceContext } from "../public/browser-reference-context.js";

test("resolves research ordinals only from links the user actually heard", () => {
  const context = createBrowserReferenceContext();

  context.registerPageResult({
    success: true,
    content: [
      '- link "AssemblyAI Voice Agent guide" [ref=e11]',
      '- link "Hidden research result" [ref=e12]',
      '- button "Search" [ref=e13]',
    ].join("\n"),
  });
  context.markPendingPageResultReady();
  context.alignPendingPageResult("I found AssemblyAI Voice Agent guide.");

  assert.deepEqual(context.resolve({
    target: "first result",
    userText: "Open the first result.",
  }), {
    success: true,
    arguments: { target: "e11" },
  });
  assert.deepEqual(context.resolve({
    target: "second result",
    userText: "Open the second result.",
  }), {
    success: false,
    error: "I can open only a research result that was just read aloud. Ask me to read the results again.",
  });
});

test("replaces stale research ordinals after the next page read", () => {
  const context = createBrowserReferenceContext();

  context.registerPageResult({ success: true, content: '- link "Old result" [ref=e1]' });
  context.markPendingPageResultReady();
  context.alignPendingPageResult("Old result.");
  context.registerPageResult({ success: true, content: '- link "New result" [ref=e2]' });
  context.markPendingPageResultReady();
  context.alignPendingPageResult("New result.");

  assert.deepEqual(context.resolve({
    target: "first result",
    userText: "Open the first result.",
  }), {
    success: true,
    arguments: { target: "e2" },
  });
});

test("does not change explicit refs or infer a deictic browser target", () => {
  const context = createBrowserReferenceContext();

  assert.deepEqual(context.resolve({ target: "e4", userText: "Click the menu." }), {
    success: true,
    arguments: { target: "e4" },
  });
  assert.deepEqual(context.resolve({ target: "that result", userText: "Open that result." }), {
    success: false,
    error: "I need a spoken research result to open.",
  });
});
