const MAX_RESEARCH_RESULTS = 3;
const MAX_LABEL_CHARACTERS = 240;
const BROWSER_REF_PATTERN = /^(?:e\d+|[a-z][a-z0-9]*e\d+)$/;
const CONTEXTUAL_RESULT_PATTERN = /\b(?:that|this|the|first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)?)\s+result\b/i;
const INDEXED_RESULT_PATTERN = /\b(?:the\s+)?(first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)?)\s+result\b/i;
const INDEXES = new Map([
  ["first", 0], ["second", 1], ["third", 2], ["fourth", 3], ["fifth", 4],
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findSpokenLabelIndex(text, label) {
  if (typeof text !== "string" || !text.trim()) {
    return -1;
  }

  const match = new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(label)}(?=$|[^A-Za-z0-9])`, "i")
    .exec(text);
  return match ? match.index + match[1].length : -1;
}

function getLinkResults(content) {
  if (typeof content !== "string") {
    return [];
  }

  const results = [];
  for (const line of content.split("\n")) {
    const match = /^\s*[-*]\s+link\s+"([^"\n]+)"\s+\[ref=([^\]]+)\]/i.exec(line);
    const label = match?.[1]?.trim();
    const target = match?.[2];

    if (!label || label.length > MAX_LABEL_CHARACTERS || !BROWSER_REF_PATTERN.test(target)) {
      continue;
    }

    results.push({ label, target });
    if (results.length === MAX_RESEARCH_RESULTS) {
      break;
    }
  }

  return results;
}

function getResultIndex(text) {
  const match = INDEXED_RESULT_PATTERN.exec(text ?? "");
  if (!match) {
    return null;
  }

  return INDEXES.get(match[1].toLowerCase()) ?? Number.parseInt(match[1], 10) - 1;
}

function isContextualResultRequest(target, userText) {
  return CONTEXTUAL_RESULT_PATTERN.test(target ?? "") || CONTEXTUAL_RESULT_PATTERN.test(userText ?? "");
}

export function createBrowserReferenceContext() {
  let spokenResults = [];
  let pendingResults = null;
  let pendingResultsReady = false;

  function registerPageResult(result) {
    if (!result?.success) {
      return;
    }

    // The backend has replaced its observed refs. Retaining a previous spoken
    // list here could remap an ordinal to a target that no longer exists.
    spokenResults = [];
    pendingResults = getLinkResults(result.content);
    pendingResultsReady = false;
  }

  function markPendingPageResultReady() {
    if (pendingResults) {
      pendingResultsReady = true;
    }
  }

  function alignPendingPageResult(agentText) {
    if (!pendingResults || !pendingResultsReady) {
      return false;
    }

    spokenResults = pendingResults
      .map((result, originalIndex) => ({
        ...result,
        originalIndex,
        spokenIndex: findSpokenLabelIndex(agentText, result.label),
      }))
      .filter((result) => result.spokenIndex >= 0)
      .sort((left, right) => left.spokenIndex - right.spokenIndex || left.originalIndex - right.originalIndex)
      .map(({ label, target }) => ({ label, target }));
    pendingResults = null;
    pendingResultsReady = false;
    return true;
  }

  function discardPendingPageResult() {
    pendingResults = null;
    pendingResultsReady = false;
  }

  function resolve({ target, userText }) {
    if (!isContextualResultRequest(target, userText)) {
      return { success: true, arguments: { target } };
    }

    const index = getResultIndex(userText) ?? getResultIndex(target);
    if (index === null) {
      return {
        success: false,
        error: "I need a spoken research result to open.",
      };
    }

    const result = spokenResults[index];
    return result
      ? { success: true, arguments: { target: result.target } }
      : {
          success: false,
          error: "I can open only a research result that was just read aloud. Ask me to read the results again.",
        };
  }

  return {
    alignPendingPageResult,
    clear: () => {
      spokenResults = [];
      pendingResults = null;
      pendingResultsReady = false;
    },
    discardPendingPageResult,
    markPendingPageResultReady,
    registerPageResult,
    resolve,
  };
}
