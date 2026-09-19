const MAX_REFERENCES = 20;
const MAX_PATH_CHARACTERS = 512;
const MAX_LABEL_CHARACTERS = 240;
const MAX_LINE_NUMBER = 100_000;

const CONTEXTUAL_PATH_PATTERN = /\b(?:that file|this file|that one|the one|it|the file with that failure|the file you just mentioned|(?:first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)?)\s+(?:(?:changed|modified)\s+)?(?:one|result|file))\b/i;
const CONTEXTUAL_SEARCH_PATTERN = /\b(?:that function|that text|that query|it)\b/i;
const INDEXED_REFERENCE_PATTERN = /\b(?:the )?(first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)?)\s+(?:(?:changed|modified)\s+)?(?:one|result|file)\b/i;
const INDEXES = new Map([
  ["first", 0], ["second", 1], ["third", 2], ["fourth", 3], ["fifth", 4],
]);
const ORDINAL_GROUP_SOURCES = new Set(["search", "git_diff", "git_status", "test_failure"]);

function isSafeProjectPath(path) {
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_PATH_CHARACTERS) {
    return false;
  }

  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/");

  return !normalized.startsWith("/") &&
    !/^[a-z]:/i.test(normalized) &&
    !normalized.includes("\0") &&
    !parts.some((part) => part === "" || part === "." || part === "..") &&
    !parts.some((part) => part === ".git" || part === "node_modules") &&
    !parts.at(-1).startsWith(".env") &&
    !["credentials.json", "token.json", "offscreen.zip", ".npmrc", ".netrc", ".pypirc"].includes(parts.at(-1)) &&
    !/\.(?:pem|key|p12|pfx|crt|cer|der)$/i.test(parts.at(-1)) &&
    !/(?:secret|credential|token|password|private)[._-]?(?:key|keys)?/i.test(parts.at(-1)) &&
    !/(?:^|[._-])(?:api|access|secret|private)?[._-]?keys?(?:$|[._-])/i.test(parts.at(-1));
}


function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findSpokenPathIndex(text, path) {
  if (typeof text !== "string" || !text.trim()) {
    return -1;
  }

  const escapedPath = escapeRegExp(path);
  const pathCharacter = "A-Za-z0-9_/\\-";
  const match = new RegExp(
    `(^|[^${pathCharacter}])(${escapedPath})(?=$|[^${pathCharacter}])`,
    "i"
  ).exec(text);

  return match ? match.index + match[1].length : -1;
}

function orderReferencesBySpokenMention(references, text) {
  return references
    .map((reference, originalIndex) => ({
      reference,
      originalIndex,
      spokenIndex: findSpokenPathIndex(text, reference.path),
    }))
    .filter((entry) => entry.spokenIndex >= 0)
    .sort((left, right) =>
      left.spokenIndex - right.spokenIndex || left.originalIndex - right.originalIndex
    )
    .map((entry) => entry.reference);
}

function normalizeLine(line) {
  return Number.isInteger(line) && line >= 1 && line <= MAX_LINE_NUMBER
    ? line
    : undefined;
}

function parseFailureLocation(location) {
  if (typeof location !== "string") {
    return null;
  }

  const match = /^(.*?)(?::(\d+)(?::\d+)?)?$/.exec(location);
  const path = match?.[1];
  const line = match?.[2] ? Number(match[2]) : undefined;

  return isSafeProjectPath(path) ? { path, line: normalizeLine(line) } : null;
}

function getReferenceIndex(text) {
  const match = INDEXED_REFERENCE_PATTERN.exec(text ?? "");
  if (!match) {
    return null;
  }

  return INDEXES.get(match[1].toLowerCase()) ?? Number.parseInt(match[1], 10) - 1;
}

function isContextualPathRequest(text, suppliedPath) {
  return CONTEXTUAL_PATH_PATTERN.test(text ?? "") || CONTEXTUAL_PATH_PATTERN.test(suppliedPath ?? "");
}

export function createProjectReferenceContext() {
  let groups = [];
  let pendingSearchGroup = null;
  let pendingSearchReady = false;

  function registerGroup(references, source, searchQuery) {
    const safeReferences = references
      .filter((reference) => isSafeProjectPath(reference.path))
      .map((reference) => ({
        path: reference.path.replaceAll("\\", "/"),
        line: normalizeLine(reference.line),
        label: typeof reference.label === "string"
          ? reference.label.slice(0, MAX_LABEL_CHARACTERS)
          : undefined,
      }));

    if (safeReferences.length === 0) {
      return;
    }

    const group = { references: safeReferences, source, searchQuery };
    groups.unshift(group);
    groups = groups.slice(0, MAX_REFERENCES);
    return group;
  }

  function registerResult(toolName, result) {
    if (!result?.success) {
      return;
    }

    if (toolName === "search_project") {
      // Search ordinals are deliberately file-oriented. Only the code-made
      // presentation list is eligible: hidden matches and first-match lines
      // must never affect either ordinal positions or a file open.
      const searchFiles = Array.isArray(result.presentation?.files)
        ? result.presentation.files.map((file) => ({ path: file?.path }))
        : Array.isArray(result.files) && result.files.length > 0
          ? result.files.map((file) => ({ path: file?.path }))
        : result.matches ?? [];

      pendingSearchGroup = registerGroup(
        searchFiles.map((match) => ({
          path: match?.path,
          line: undefined,
          label: undefined,
        })),
        "search",
        typeof result.query === "string" ? result.query.slice(0, 200) : undefined
      ) ?? null;
      pendingSearchReady = false;
    } else if (toolName === "get_git_diff") {
      const presentedFiles = Array.isArray(result.presentation?.files)
        ? result.presentation.files
        : [];
      pendingSearchGroup = registerGroup(
        presentedFiles.map((file) => ({ path: file?.path })),
        "git_diff"
      ) ?? null;
      pendingSearchReady = false;
    } else if (["read_project_file", "open_project_file"].includes(toolName)) {
      registerGroup([{ path: result.path, line: result.line ?? result.startLine }], toolName);
    } else if (toolName === "get_git_status") {
      registerGroup(
        ["staged", "unstaged", "untracked"].flatMap((key) => result[key] ?? [])
          .map((entry) => ({ path: entry?.path })),
        "git_status"
      );
    } else if (toolName === "run_project_tests") {
      registerGroup(
        (result.failures ?? []).map((failure) => parseFailureLocation(failure?.file)).filter(Boolean),
        "test_failure"
      );
    }
  }

  function markPendingSearchResultReady() {
    if (pendingSearchGroup) {
      pendingSearchReady = true;
    }
  }

  function alignPendingSearchResult(agentText) {
    if (!pendingSearchGroup || !pendingSearchReady) {
      return false;
    }

    const group = pendingSearchGroup;
    pendingSearchGroup = null;
    pendingSearchReady = false;

    if (!groups.includes(group)) {
      return false;
    }

    // Follow-up ordinals must reflect what the user actually heard, not a
    // hidden pre-speech ordering. Unspoken files deliberately stop being
    // ordinal candidates once the search response has been spoken.
    group.references = orderReferencesBySpokenMention(group.references, agentText);
    return true;
  }

  function discardPendingSearchResult() {
    if (!pendingSearchGroup) {
      return;
    }

    if (groups.includes(pendingSearchGroup)) {
      pendingSearchGroup.references = [];
    }

    pendingSearchGroup = null;
    pendingSearchReady = false;
  }

  function resolve({ toolName, arguments: suppliedArguments = {}, userText }) {
    if (toolName === "search_project") {
      const query = suppliedArguments.query;
      if (!CONTEXTUAL_SEARCH_PATTERN.test(userText ?? "") && !CONTEXTUAL_SEARCH_PATTERN.test(query ?? "")) {
        return { success: true, arguments: suppliedArguments };
      }

      const group = groups.find((candidate) => candidate.source === "search" && candidate.searchQuery);
      return group
        ? { success: true, arguments: { ...suppliedArguments, query: group.searchQuery } }
        : { success: false, error: "I need the function or text to search for." };
    }

    if (!["read_project_file", "open_project_file", "get_git_diff"].includes(toolName)) {
      return { success: true, arguments: suppliedArguments };
    }

    const suppliedPath = suppliedArguments.path;
    if (!isContextualPathRequest(userText, suppliedPath)) {
      return { success: true, arguments: suppliedArguments };
    }

    const index = getReferenceIndex(userText) ?? getReferenceIndex(suppliedPath);
    // Explicit ordinals belong to the latest list-producing result even after
    // opening or reading one item from that list. Deictic references such as
    // "it" still follow the most recently selected single file.
    const group = index === null
      ? groups[0]
      : groups.find((candidate) => ORDINAL_GROUP_SOURCES.has(candidate.source));
    const uniqueReferences = group
      ? [...new Map(group.references.map((reference) => [reference.path, reference])).values()]
      : [];
    const reference = index === null
      ? uniqueReferences.length === 1 ? uniqueReferences[0] : null
      : uniqueReferences[index];

    if (!reference) {
      const options = uniqueReferences.slice(0, 3).map((item) => item.path);
      return {
        success: false,
        error: options.length > 1
          ? `Please choose one: ${options.join(", ")}.`
          : "I need a project file name or a recent result to use.",
      };
    }

    const lineMatch = /\bline\s+(\d+)\b/i.exec(userText ?? "");
    // A search-derived file selection must not inherit a search match line or
    // model-supplied line. Other reference sources (such as a test failure)
    // retain their source-specific line behavior. Explicit speech always wins.
    const line = normalizeLine(lineMatch
      ? Number(lineMatch[1])
      : group?.source === "search" ? undefined : suppliedArguments.line ?? reference.line);
    const argumentsWithPath = { ...suppliedArguments, path: reference.path };

    if (group?.source === "search") {
      delete argumentsWithPath.line;
    }

    if (toolName === "open_project_file" && line !== undefined) {
      argumentsWithPath.line = line;
    }

    return { success: true, arguments: argumentsWithPath };
  }

  return {
    alignPendingSearchResult,
    clear: () => { groups = []; pendingSearchGroup = null; pendingSearchReady = false; },
    discardPendingSearchResult,
    markPendingSearchResultReady,
    registerResult,
    resolve,
    get size() { return groups.length; },
  };
}
