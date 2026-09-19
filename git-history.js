import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseGitPatch } from "./git-diff.js";
import { isDeniedProjectPath, normalizeProjectRelativePath } from "./project-workspace.js";

const runExecFile = promisify(execFile);
const GIT_TIMEOUT_MS = 5_000;
const MAX_GIT_HISTORY_BYTES = 64 * 1024;
const MAX_GIT_DIFF_BYTES = 256 * 1024;
export const DEFAULT_HISTORY_LIMIT = 5;
export const MAX_HISTORY_LIMIT = 10;
const MAX_CHANGED_FILES = 8;
const MAX_SUBJECT_CHARACTERS = 200;
const MAX_AUTHOR_CHARACTERS = 100;
const COMMIT_ID_PATTERN = /^[0-9a-f]{40}$/i;
const HISTORY_FORMAT = "%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%P%x1e";

function gitOptions(projectRoot, maxBuffer) {
  return { cwd: projectRoot, shell: false, timeout: GIT_TIMEOUT_MS, maxBuffer };
}

function clampHistoryLimit(limit) {
  return Number.isInteger(limit) && limit > 0
    ? Math.min(limit, MAX_HISTORY_LIMIT)
    : DEFAULT_HISTORY_LIMIT;
}

export function parseGitHistory(output) {
  return output.split("\u001e").flatMap((rawRecord) => {
    // Git adds a newline after each formatted record. Strip only that record
    // boundary whitespace before validating the immutable hash; do not alter
    // fields within a commit record.
    const record = rawRecord.trimStart();
    if (!record) return [];
    const [id, shortId, subject, author, authoredAt, parents] = record.split("\u001f");
    if (!COMMIT_ID_PATTERN.test(id ?? "") || !shortId || subject === undefined || !author || !authoredAt) return [];
    return [{
      id,
      shortId,
      subject: subject.slice(0, MAX_SUBJECT_CHARACTERS),
      author: author.slice(0, MAX_AUTHOR_CHARACTERS),
      authoredAt,
      parentCount: parents ? parents.split(" ").length : 0,
    }];
  }).map((commit, index) => ({ ...commit, position: index + 1 }));
}

export async function getGitHistory({ projectRoot, limit, execFileImpl = runExecFile }) {
  try {
    const { stdout } = await execFileImpl("git", [
      "log", "-n", String(clampHistoryLimit(limit)), `--format=${HISTORY_FORMAT}`,
    ], gitOptions(projectRoot, MAX_GIT_HISTORY_BYTES));
    const commits = parseGitHistory(stdout);
    return commits.length > 0
      ? { success: true, commits, truncated: commits.length >= clampHistoryLimit(limit) }
      : { success: false, error: "This repository has no commits yet.", terminal: true };
  } catch (error) {
    console.error("Git history inspection failed:", error.message);
    return { success: false, error: "Could not inspect the recent project Git history." };
  }
}

function parseNameStatus(output) {
  const records = output.split("\0");
  const files = [];
  const statusNames = { A: "added", D: "deleted", M: "modified", T: "type_changed" };
  for (let index = 0; index + 1 < records.length; index += 2) {
    const status = records[index];
    const path = normalizeProjectRelativePath(records[index + 1]);
    if (!status || !path || isDeniedProjectPath(path)) continue;
    files.push({ path, status: statusNames[status[0]] ?? "changed" });
  }
  return files;
}

export async function getCommitDiff({ projectRoot, commit, execFileImpl = runExecFile }) {
  if (!commit || !COMMIT_ID_PATTERN.test(commit.id ?? "")) {
    return { success: false, error: "commit_unavailable", terminal: true };
  }
  if (commit.parentCount > 1) {
    return { success: false, error: "merge_unsupported", terminal: true };
  }
  try {
    const { stdout: statusOutput } = await execFileImpl("git", [
      "show", "--format=", "--no-ext-diff", "--no-color", "--no-renames", "--name-status", "-z", commit.id, "--",
    ], gitOptions(projectRoot, MAX_GIT_DIFF_BYTES));
    const changes = parseNameStatus(statusOutput);
    const files = [];
    let truncated = changes.length > MAX_CHANGED_FILES;
    for (const change of changes.slice(0, MAX_CHANGED_FILES)) {
      const { stdout } = await execFileImpl("git", [
        "show", "--format=", "--no-ext-diff", "--no-color", "--no-renames", "--unified=3", commit.id, "--", change.path,
      ], gitOptions(projectRoot, MAX_GIT_DIFF_BYTES));
      const patch = parseGitPatch(stdout);
      files.push({ ...change, additions: patch.additions, deletions: patch.deletions, hunks: patch.hunks });
      truncated ||= patch.truncated;
    }
    const result = {
      success: true,
      commit: { shortId: commit.shortId, subject: commit.subject, author: commit.author, authoredAt: commit.authoredAt },
      files,
      truncated,
      summary: `${files.length} ${files.length === 1 ? "file" : "files"} changed in ${commit.subject ?? "this commit"}.`,
      presentation: { files: files.slice(0, 4).map((file, index) => ({ position: index + 1, path: file.path })), truncated: truncated || files.length > 4 },
    };
    if (truncated) result.truncation = "Only the first 8 safe changed files and first 2 bounded hunks per file are included.";
    return result;
  } catch (error) {
    console.error("Commit diff inspection failed:", error.message);
    return { success: false, error: "Could not inspect that recent project commit." };
  }
}
