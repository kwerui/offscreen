const DEFAULT_CAPACITY = 25;
const MAX_SUMMARY_CHARACTERS = 280;
const MAX_METADATA_ENTRIES = 8;
const MAX_METADATA_VALUE_CHARACTERS = 160;

function isSafeProjectPath(path) {
  return typeof path === "string" &&
    path.length > 0 &&
    path.length <= 512 &&
    !path.startsWith("/") &&
    !/^[a-z]:/i.test(path) &&
    !path.includes("..") &&
    !path.split("/").at(-1).startsWith(".env");
}

function getStatus(result) {
  if (result?.cancelled) return "cancelled";
  if (result?.timedOut || result?.errorCode === "test_timeout") return "timeout";
  return result?.success ? "success" : "failure";
}

function getFallbackSummary(tool, status, result) {
  if (tool === "run_project_tests" && status === "cancelled") {
    return "The project test run was cancelled.";
  }

  if (status === "timeout") return `${tool} timed out.`;
  if (status === "failure") return result?.error?.slice(0, MAX_SUMMARY_CHARACTERS) || `${tool} failed.`;
  return `${tool} succeeded.`;
}

function sanitizeTarget(target) {
  const safeTarget = {};

  if (isSafeProjectPath(target?.path)) safeTarget.path = target.path;
  if (Number.isInteger(target?.line) && target.line >= 1 && target.line <= 100_000) {
    safeTarget.line = target.line;
  }

  return safeTarget;
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return {};

  return Object.fromEntries(
    Object.entries(metadata)
      .slice(0, MAX_METADATA_ENTRIES)
      .filter(([key, value]) => /^[a-z][a-zA-Z0-9_]{0,40}$/.test(key) &&
        (typeof value === "string" || typeof value === "number" || typeof value === "boolean"))
      .map(([key, value]) => [key, typeof value === "string"
        ? value.slice(0, MAX_METADATA_VALUE_CHARACTERS)
        : value])
  );
}

export function createSessionActivityLedger({ capacity = DEFAULT_CAPACITY } = {}) {
  const maximumReceipts = Number.isInteger(capacity) && capacity > 0
    ? Math.min(capacity, 50)
    : DEFAULT_CAPACITY;
  const receipts = [];
  const receiptsByCallId = new Map();
  let nextSequence = 1;

  function begin({ callId, tool, category, target, metadata }) {
    if (typeof callId !== "string" || !callId || receiptsByCallId.has(callId)) return false;

    const receipt = {
      id: `activity-${nextSequence}`,
      sequence: nextSequence++,
      tool,
      category,
      status: "running",
      summary: "Action is running.",
      target: sanitizeTarget(target),
      metadata: sanitizeMetadata(metadata),
      startedAt: new Date().toISOString(),
    };

    receipts.push(receipt);
    receiptsByCallId.set(callId, receipt);

    while (receipts.length > maximumReceipts) {
      const oldestReceipt = receipts.shift();
      for (const [storedCallId, storedReceipt] of receiptsByCallId) {
        if (storedReceipt === oldestReceipt) receiptsByCallId.delete(storedCallId);
      }
    }

    return true;
  }

  function complete(callId, result) {
    const receipt = receiptsByCallId.get(callId);

    if (!receipt || receipt.status !== "running") return false;

    receipt.status = getStatus(result);
    receipt.summary = typeof result?.summary === "string"
      ? result.summary.slice(0, MAX_SUMMARY_CHARACTERS)
      : getFallbackSummary(receipt.tool, receipt.status, result);
    receipt.completedAt = new Date().toISOString();
    return true;
  }

  function setTarget(callId, target) {
    const receipt = receiptsByCallId.get(callId);
    if (!receipt || receipt.status !== "running") return false;
    receipt.target = sanitizeTarget(target);
    return true;
  }

  function list({ filter = "all", limit = 5 } = {}) {
    const boundedLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 10) : 5;
    const matchingReceipts = filter === "failed"
      ? receipts.filter((receipt) => ["failure", "cancelled", "timeout"].includes(receipt.status))
      : receipts;

    return matchingReceipts.slice(-boundedLimit).map((receipt) => ({ ...receipt }));
  }

  return { begin, complete, setTarget, list, clear: () => { receipts.length = 0; receiptsByCallId.clear(); } };
}
