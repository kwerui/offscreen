import assert from "node:assert/strict";
import test from "node:test";

import { createSessionActivityLedger } from "../public/session-activity-ledger.js";

test("records bounded terminal receipts in action order", () => {
  const ledger = createSessionActivityLedger({ capacity: 2 });

  ledger.begin({ callId: "status", tool: "get_git_status", category: "git_status" });
  ledger.complete("status", { success: true, summary: "Checked Git status: clean." });
  ledger.begin({ callId: "search", tool: "search_project", category: "project_search" });
  ledger.complete("search", { success: false, error: "Could not search the project." });
  ledger.begin({ callId: "tests", tool: "run_project_tests", category: "project_tests" });
  ledger.complete("tests", { success: false, cancelled: true });

  assert.deepEqual(ledger.list({ filter: "all", limit: 5 }).map((receipt) => ({
    tool: receipt.tool,
    status: receipt.status,
    summary: receipt.summary,
  })), [
    { tool: "search_project", status: "failure", summary: "Could not search the project." },
    { tool: "run_project_tests", status: "cancelled", summary: "The project test run was cancelled." },
  ]);
  assert.equal(ledger.complete("tests", { success: true }), false);
  assert.equal(ledger.list({ filter: "failed", limit: 5 }).length, 2);
  ledger.clear();
  assert.deepEqual(ledger.list({ filter: "all", limit: 5 }), []);
});

test("does not retain unsafe metadata or absolute paths", () => {
  const ledger = createSessionActivityLedger();
  ledger.begin({
    callId: "open",
    tool: "open_project_file",
    category: "project_file",
    target: { path: "/Users/kr/Documents/offscreen/.env", contents: "secret" },
  });
  ledger.complete("open", { success: true, summary: "Opened public/app.js." });

  assert.deepEqual(ledger.list({ filter: "all", limit: 1 })[0].target, {});
});
