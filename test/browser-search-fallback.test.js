import assert from "node:assert/strict";
import test from "node:test";
import {
  createWebSearchRequests,
  shouldTryWebSearchFallback,
} from "../public/browser-search.js";

test("offers a bounded secondary provider after the fixed primary provider", () => {
  assert.deepEqual(createWebSearchRequests("AssemblyAI voice agents"), [
    {
      provider: "DuckDuckGo",
      query: "AssemblyAI voice agents",
      url: "https://html.duckduckgo.com/html/?q=AssemblyAI%20voice%20agents",
    },
    {
      provider: "Bing",
      query: "AssemblyAI voice agents",
      url: "https://www.bing.com/search?q=AssemblyAI%20voice%20agents",
    },
  ]);
});

test("falls back only for a challenge or a snapshot without ordinary links", () => {
  assert.equal(shouldTryWebSearchFallback("Verify you are human"), true);
  assert.equal(shouldTryWebSearchFallback("No results found"), true);
  assert.equal(shouldTryWebSearchFallback('- link "AssemblyAI" [ref=e1]'), false);
});
