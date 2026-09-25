const MAX_RESULTS = 5;

const INDEXES = new Map([
  ["first", 0],
  ["second", 1],
  ["third", 2],
  ["fourth", 3],
  ["fifth", 4],
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&");
}

function findSpokenLabelIndex(text, label) {
  if (typeof text !== "string" || typeof label !== "string" || !text.trim() || !label.trim()) {
    return -1;
  }

  const escaped = escapeRegExp(label.trim());
  const match = new RegExp(
    "(^|[^A-Za-z0-9])(" + escaped + ")(?=$|[^A-Za-z0-9])",
    "i"
  ).exec(text);

  return match ? match.index + match[1].length : -1;
}

function getPosition(argumentsObject, userText) {
  if (Number.isInteger(argumentsObject?.position)) {
    return argumentsObject.position >= 1 && argumentsObject.position <= MAX_RESULTS
      ? argumentsObject.position - 1
      : null;
  }

  const match = /\b(first|second|third|fourth|fifth)\s+(?:result|link|one)\b/i.exec(userText ?? "");
  return match ? INDEXES.get(match[1].toLowerCase()) : null;
}

export function extractBrowserLinkResults(content) {
  if (typeof content !== "string") return [];

  const results = [];
  const seenRefs = new Set();
  const pattern = /^\s*[-*]\s*link\s+"([^"\n]{1,240})"\s+\[ref=((?:e\d+|[a-z][a-z0-9]*e\d+))\]/gim;

  for (const match of content.matchAll(pattern)) {
    if (seenRefs.has(match[2])) continue;

    seenRefs.add(match[2]);
    results.push({
      label: match[1].trim(),
      ref: match[2],
    });

    if (results.length >= MAX_RESULTS) break;
  }

  return results;
}

export function createBrowserResultContext() {
  let pending = null;
  let pendingReady = false;
  let spokenResults = [];

  function registerResult(content) {
    // A fresh page read/find replaces the browser backend's observed refs.
    // Clear prior ordinal authority immediately so stale refs cannot survive.
    spokenResults = [];
    pending = extractBrowserLinkResults(content);
    pendingReady = false;
  }

  function markPendingReady() {
    if (pending) pendingReady = true;
  }

  function alignPending(agentText) {
    if (!pending || !pendingReady) return false;

    spokenResults = pending
      .map((result, index) => ({
        result,
        index,
        spokenIndex: findSpokenLabelIndex(agentText, result.label),
      }))
      .filter((entry) => entry.spokenIndex >= 0)
      .sort((left, right) =>
        left.spokenIndex - right.spokenIndex || left.index - right.index
      )
      .map((entry) => entry.result);

    pending = null;
    pendingReady = false;
    return true;
  }

  function discardPending() {
    pending = null;
    pendingReady = false;
  }

  function clear() {
    pending = null;
    pendingReady = false;
    spokenResults = [];
  }

  function resolve(argumentsObject, userText) {
    const index = getPosition(argumentsObject, userText);
    const result = index === null ? null : spokenResults[index];

    return result
      ? {
          success: true,
          target: result.ref,
          label: result.label,
        }
      : {
          success: false,
          error:
            "I can open only a numbered link result you just heard. Ask me to read or find the page again.",
        };
  }

  return {
    alignPending,
    clear,
    discardPending,
    markPendingReady,
    registerResult,
    resolve,
    get size() {
      return spokenResults.length;
    },
  };
}
