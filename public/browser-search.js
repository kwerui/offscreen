const MAX_QUERY_CHARACTERS = 400;
const SEARCH_BASE_URL = "https://html.duckduckgo.com/html/?q=";

export function createWebSearchRequest(query) {
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

  return {
    success: true,
    query: normalizedQuery,
    url: SEARCH_BASE_URL + encodeURIComponent(normalizedQuery),
  };
}
