import assert from "node:assert/strict";
import test from "node:test";
import {
  createBrowserResultContext,
  extractBrowserLinkResults,
} from "../public/browser-result-context.js";

test("extracts only bounded ordinary links from browser output", () => {
  const content = [
    '- link "Alpha" [ref=e1]',
    '- button "Delete" [ref=e2]',
    '- link "Beta" [ref=f1e3]',
    '- link "Alpha duplicate ref" [ref=e1]',
    '- link "Gamma" [ref=e4]',
    '- link "Delta" [ref=e5]',
    '- link "Epsilon" [ref=e6]',
    '- link "Zeta" [ref=e7]',
  ].join("\n");

  assert.deepEqual(extractBrowserLinkResults(content), [
    { label: "Alpha", ref: "e1" },
    { label: "Beta", ref: "f1e3" },
    { label: "Gamma", ref: "e4" },
    { label: "Delta", ref: "e5" },
    { label: "Epsilon", ref: "e6" },
  ]);
});

test("aligns ordinals only to link labels actually spoken by the agent", () => {
  const context = createBrowserResultContext();

  context.registerResult([
    '- link "Alpha result" [ref=e1]',
    '- link "Beta result" [ref=e2]',
    '- link "Hidden result" [ref=e3]',
  ].join("\n"));
  context.markPendingReady();

  assert.equal(
    context.alignPending("I found Beta result first, and Alpha result second."),
    true
  );

  assert.deepEqual(context.resolve({ position: 1 }, "open the first result"), {
    success: true,
    target: "e2",
    label: "Beta result",
  });
  assert.deepEqual(context.resolve({}, "open the second result"), {
    success: true,
    target: "e1",
    label: "Alpha result",
  });
  assert.equal(context.resolve({ position: 3 }, "open the third result").success, false);
});

test("a fresh browser read clears earlier ordinal authority immediately", () => {
  const context = createBrowserResultContext();

  context.registerResult('- link "Old result" [ref=e1]');
  context.markPendingReady();
  context.alignPending("Old result");
  assert.equal(context.resolve({ position: 1 }, "").success, true);

  context.registerResult('- link "New result" [ref=e9]');
  assert.equal(context.resolve({ position: 1 }, "").success, false);

  context.markPendingReady();
  context.alignPending("New result");
  assert.deepEqual(context.resolve({ position: 1 }, ""), {
    success: true,
    target: "e9",
    label: "New result",
  });
});

test("discarded or cleared pending browser results never become selectable", () => {
  const context = createBrowserResultContext();

  context.registerResult('- link "Alpha" [ref=e1]');
  context.markPendingReady();
  context.discardPending();
  assert.equal(context.alignPending("Alpha"), false);
  assert.equal(context.resolve({ position: 1 }, "").success, false);

  context.registerResult('- link "Beta" [ref=e2]');
  context.markPendingReady();
  context.alignPending("Beta");
  context.clear();
  assert.equal(context.resolve({ position: 1 }, "").success, false);
});

test("rejects positions outside the bounded spoken result range", () => {
  const context = createBrowserResultContext();
  context.registerResult('- link "Alpha" [ref=e1]');
  context.markPendingReady();
  context.alignPending("Alpha");

  assert.equal(context.resolve({ position: 0 }, "").success, false);
  assert.equal(context.resolve({ position: 6 }, "").success, false);
  assert.equal(context.resolve({}, "open the sixth result").success, false);
});
