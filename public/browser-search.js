const MAX_QUERY_CHARACTERS = 400;
import { extractBrowserLinkResults } from "./browser-result-context.js";

const SEARCH_PROVIDERS = [
  { name: "DuckDuckGo", baseUrl: "https://html.duckduckgo.com/html/?q=" },
  { name: "Bing", baseUrl: "https://www.bing.com/search?q=" },
];
const CHALLENGE_PATTERN = /captcha|challenge|unusual traffic|verify (?:you are )?human|robot check/i;

export function createWebSearchRequest(query) {
  const request = normalizeWebSearchQuery(query);

  return request.success
    ? { ...request, url: SEARCH_PROVIDERS[0].baseUrl + encodeURIComponent(request.query) }
    : request;
}

export function createWebSearchRequests(query) {
  const request = normalizeWebSearchQuery(query);

  if (!request.success) return request;

  return SEARCH_PROVIDERS.map((provider) => ({
    provider: provider.name,
    query: request.query,
    url: provider.baseUrl + encodeURIComponent(request.query),
  }));
}

export function shouldTryWebSearchFallback(content) {
  return (
    typeof content !== "string" ||
    CHALLENGE_PATTERN.test(content) ||
    extractBrowserLinkResults(content).length === 0
  );
}

function normalizeWebSearchQuery(query) {
  if (typeof query !== "string") {
    return { success: false, error: "Web search query is required." };
  }

  const normalizedQuery = query
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalizedQuery) {
    return { success: false, error: "Web search query is required." };
  }

  if (normalizedQuery.length > MAX_QUERY_CHARACTERS) {
    return { success: false, error: "Web search query is too long." };
  }

  return { success: true, query: normalizedQuery };
}
