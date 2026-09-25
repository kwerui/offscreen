import assert from "node:assert/strict";
import test from "node:test";
import { createWebSearchRequest } from "../public/browser-search.js";

test("builds a fixed-provider HTTPS search URL from a bounded query", () => {
  assert.deepEqual(createWebSearchRequest("  AssemblyAI   voice agents  "), {
    success: true,
    query: "AssemblyAI voice agents",
    url: "https://html.duckduckgo.com/html/?q=AssemblyAI%20voice%20agents",
  });
});

test("sanitizes control characters without changing ordinary query punctuation", () => {
  const result = createWebSearchRequest("voice\u0007 agents: safety?");
  assert.equal(result.success, true);
  assert.equal(result.query, "voice agents: safety?");
  assert.match(result.url, /^https:\/\/html\.duckduckgo\.com\/html\/\?q=/);
});

test("rejects missing, empty, and oversized search queries", () => {
  assert.equal(createWebSearchRequest().success, false);
  assert.equal(createWebSearchRequest("   ").success, false);
  assert.equal(createWebSearchRequest("x".repeat(401)).success, false);
});
