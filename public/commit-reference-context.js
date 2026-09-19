const INDEXES = new Map([["latest", 0], ["first", 0], ["second", 1], ["third", 2], ["fourth", 3], ["fifth", 4]]);

function getPosition(argumentsObject, userText) {
  if (Number.isInteger(argumentsObject?.position) && argumentsObject.position >= 1) return argumentsObject.position - 1;
  const match = /\b(latest|first|second|third|fourth|fifth)\b/i.exec(userText ?? "");
  return match ? INDEXES.get(match[1].toLowerCase()) : null;
}

function spokenIndex(text, subject) {
  return typeof subject === "string" ? text.toLowerCase().indexOf(subject.toLowerCase()) : -1;
}

export function createCommitReferenceContext() {
  let pending = null;
  let ready = false;
  let commits = [];
  return {
    registerHistory(result) {
      if (result?.success && Array.isArray(result.commits)) pending = result.commits.filter((commit) => typeof commit.reference === "string");
    },
    markPendingHistoryReady() { if (pending) ready = true; },
    alignPendingHistory(agentText) {
      if (!pending || !ready) return false;
      commits = pending.map((commit, index) => ({ commit, index, spoken: spokenIndex(agentText, commit.subject) }))
        .filter((entry) => entry.spoken >= 0)
        .sort((left, right) => left.spoken - right.spoken || left.index - right.index)
        .map((entry) => entry.commit);
      pending = null;
      ready = false;
      return true;
    },
    discardPendingHistory() { pending = null; ready = false; },
    clear() { pending = null; ready = false; commits = []; },
    resolve(argumentsObject, userText) {
      const position = getPosition(argumentsObject, userText);
      const commit = position === null ? null : commits[position];
      return commit
        ? { success: true, reference: commit.reference }
        : { success: false, error: "I can inspect only a commit from the recent list you heard. Ask me to refresh the recent commits." };
    },
  };
}
