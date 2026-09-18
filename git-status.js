import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runExecFile = promisify(execFile);
const MAX_GIT_STATUS_BYTES = 64 * 1024;

const STATUS_NAMES = Object.freeze({
  A: "added",
  C: "copied",
  D: "deleted",
  M: "modified",
  R: "renamed",
  T: "type_changed",
  U: "unmerged",
});

function parseBranch(header) {
  const branchLine = header.slice(3);
  const noCommitsMatch = /^No commits yet on (.+)$/.exec(branchLine);

  if (noCommitsMatch) {
    return noCommitsMatch[1];
  }

  if (branchLine === "HEAD (no branch)") {
    return null;
  }

  return branchLine.split("...")[0] || null;
}

function getStatusName(status) {
  return STATUS_NAMES[status] || "changed";
}

function formatCount(count, label) {
  return `${count} ${label} ${count === 1 ? "file" : "files"}`;
}

function createSummary({ branch, clean, staged, unstaged, untracked }) {
  if (clean) {
    return branch
      ? `Working tree is clean on ${branch}.`
      : "Working tree is clean.";
  }

  const parts = [
    staged.length > 0 && formatCount(staged.length, "staged"),
    unstaged.length > 0 && formatCount(unstaged.length, "unstaged"),
    untracked.length > 0 && formatCount(untracked.length, "untracked"),
  ].filter(Boolean);

  if (parts.length === 1) {
    return `${parts[0]}.`;
  }

  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}.`;
}

function addChangedFile(files, path, status, originalPath) {
  const entry = { path, status: getStatusName(status) };

  if (originalPath) {
    entry.originalPath = originalPath;
  }

  files.push(entry);
}

export function parseGitStatus(output) {
  const records = output.split("\0");
  let branch = null;
  const staged = [];
  const unstaged = [];
  const untracked = [];

  for (let index = 0; index < records.length; index++) {
    const record = records[index];

    if (!record) {
      continue;
    }

    if (record.startsWith("## ")) {
      branch = parseBranch(record);
      continue;
    }

    const indexStatus = record[0];
    const worktreeStatus = record[1];
    const path = record.slice(3);

    if (indexStatus === "?" && worktreeStatus === "?") {
      untracked.push({ path, status: "untracked" });
      continue;
    }

    const isRenameOrCopy = indexStatus === "R" || indexStatus === "C";
    const originalPath = isRenameOrCopy ? records[++index] : undefined;

    if (indexStatus !== " ") {
      addChangedFile(staged, path, indexStatus, originalPath);
    }

    if (worktreeStatus !== " ") {
      addChangedFile(unstaged, path, worktreeStatus, originalPath);
    }
  }

  const clean = staged.length === 0 && unstaged.length === 0 && untracked.length === 0;
  const result = { branch, clean, staged, unstaged, untracked };

  return { ...result, summary: createSummary(result) };
}

export async function getGitStatus({
  projectRoot,
  execFileImpl = runExecFile,
}) {
  try {
    const { stdout } = await execFileImpl(
      "git",
      ["status", "--porcelain=v1", "--branch", "-z"],
      { cwd: projectRoot, maxBuffer: MAX_GIT_STATUS_BYTES }
    );

    return { success: true, ...parseGitStatus(stdout) };
  } catch (error) {
    console.error("Git status inspection failed:", error.message);
    return {
      success: false,
      error: "Could not inspect the project Git status.",
    };
  }
}
