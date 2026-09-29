import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseGitStatus } from "./git-status.js";
import {
  getProjectFile,
  isDeniedProjectPath,
  normalizeProjectRelativePath,
} from "./project-workspace.js";

const runExecFile = promisify(execFile);
const GIT_TIMEOUT_MS = 5_000;
const MAX_GIT_OUTPUT_BYTES = 256 * 1024;
const MAX_CHANGED_FILES = 8;
const MAX_HUNKS_PER_STATE = 2;
const MAX_HUNK_LINES = 40;
const MAX_HUNK_CHARACTERS = 400;
const MAX_PRESENTED_DIFF_FILES = 4;

const GIT_OPTIONS = Object.freeze({
  shell: false,
  timeout: GIT_TIMEOUT_MS,
  maxBuffer: MAX_GIT_OUTPUT_BYTES,
});

function failure(error) {
  return { success: false, error };
}

function createGitOptions(projectRoot) {
  return { cwd: projectRoot, ...GIT_OPTIONS };
}

function createState(status, patch) {
  return {
    status,
    additions: patch.additions,
    deletions: patch.deletions,
    hunks: patch.hunks,
  };
}

function isSafeGitPath(path) {
  const normalizedPath = normalizeProjectRelativePath(path);
  return normalizedPath && !isDeniedProjectPath(normalizedPath)
    ? normalizedPath
    : null;
}

function getSummary(files) {
  const trackedCount = files.filter((file) => !file.untracked).length;
  const untrackedCount = files.filter((file) => file.untracked).length;
  const parts = [];

  if (trackedCount > 0) {
    parts.push(`${trackedCount} tracked ${trackedCount === 1 ? "file" : "files"} with Git diff content`);
  }

  if (untrackedCount > 0) {
    parts.push(`${untrackedCount} untracked ${untrackedCount === 1 ? "file" : "files"} without a Git diff`);
  }

  return parts.length > 0 ? `${parts.join(" and ")}.` : "No safe current Git changes are available.";
}

function createDiffPresentation(files, truncated) {
  const presentedFiles = files.slice(0, MAX_PRESENTED_DIFF_FILES);

  return {
    files: presentedFiles.map((file, index) => ({
      position: index + 1,
      path: file.path,
    })),
    truncated: truncated || files.length > presentedFiles.length,
  };
}

export function parseGitPatch(output) {
  const hunks = [];
  let additions = 0;
  let deletions = 0;
  let truncated = false;
  let currentHunk = null;

  function finishHunk() {
    if (!currentHunk) {
      return;
    }

    const lines = currentHunk.lines;
    if (lines.length > MAX_HUNK_LINES) {
      lines.length = MAX_HUNK_LINES;
      truncated = true;
    }

    let text = lines.join("\n");
    if (text.length > MAX_HUNK_CHARACTERS) {
      text = `${text.slice(0, MAX_HUNK_CHARACTERS - 1)}…`;
      truncated = true;
    }

    if (hunks.length < MAX_HUNKS_PER_STATE) {
      hunks.push({
        oldStart: currentHunk.oldStart,
        newStart: currentHunk.newStart,
        text,
      });
    } else {
      truncated = true;
    }

    currentHunk = null;
  }

  const patchLines = output.split(/\r?\n/);
  if (patchLines.at(-1) === "") {
    patchLines.pop();
  }

  for (const line of patchLines) {
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      finishHunk();
      currentHunk = {
        oldStart: Number(header[1]),
        newStart: Number(header[2]),
        lines: [line],
      };
      continue;
    }

    if (!currentHunk) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions++;
    }

    currentHunk.lines.push(line);
  }

  finishHunk();
  return { additions, deletions, hunks, truncated };
}

async function runGit(execFileImpl, projectRoot, argumentsList) {
  return execFileImpl("git", argumentsList, createGitOptions(projectRoot));
}

async function isAvailableDiffPath(projectRoot, path, status, getProjectFileImpl) {
  if (!isSafeGitPath(path)) {
    return false;
  }

  // Deleted files cannot be resolved in the working tree, but their safe,
  // project-relative name is enough for Git to describe their removal.
  if (status === "deleted") {
    return true;
  }

  return Boolean(await getProjectFileImpl(projectRoot, path));
}

function buildChangeMap(status) {
  const changes = new Map();

  for (const [stateName, entries] of [["staged", status.staged], ["unstaged", status.unstaged]]) {
    for (const entry of entries) {
      const path = isSafeGitPath(entry.path);
      if (!path) {
        continue;
      }

      const change = changes.get(path) ?? { path };
      change[stateName] = entry.status;
      changes.set(path, change);
    }
  }

  for (const entry of status.untracked) {
    const path = isSafeGitPath(entry.path);
    if (!path) {
      continue;
    }

    const change = changes.get(path) ?? { path };
    change.untracked = true;
    changes.set(path, change);
  }

  return changes;
}

export async function getGitDiff({
  projectRoot,
  path,
  execFileImpl = runExecFile,
  getProjectFileImpl = getProjectFile,
}) {
  const normalizedRequestedPath = path === undefined
    ? undefined
    : normalizeProjectRelativePath(path);
  const requestedPath = normalizedRequestedPath && !isDeniedProjectPath(normalizedRequestedPath)
    ? normalizedRequestedPath
    : null;

  if (path !== undefined && !normalizedRequestedPath) {
    return { success: false, error: "invalid_path", terminal: true };
  }

  if (path !== undefined && !requestedPath) {
    return { success: false, error: "path_denied", terminal: true };
  }

  if (requestedPath && !await getProjectFileImpl(projectRoot, requestedPath)) {
    return { success: false, error: "path_unavailable", terminal: true };
  }

  let status;
  try {
    const { stdout } = await runGit(
      execFileImpl,
      projectRoot,
      ["status", "--porcelain=v1", "--branch", "-z"]
    );
    status = parseGitStatus(stdout);
  } catch (error) {
    console.error("Git diff status inspection failed:", error.message);
    return failure("Could not inspect the project Git diff.");
  }

  const changeMap = buildChangeMap(status);
  const requestedChange = requestedPath ? changeMap.get(requestedPath) : null;

  if (requestedPath && !requestedChange) {
    return { success: false, error: "no_changes", terminal: true };
  }

  const candidates = requestedChange
    ? [requestedChange]
    : [...changeMap.values()];
  const files = [];
  let truncated = candidates.length > MAX_CHANGED_FILES;

  for (const change of candidates.slice(0, MAX_CHANGED_FILES)) {
    if (change.untracked && !change.staged && !change.unstaged) {
      if (await getProjectFileImpl(projectRoot, change.path)) {
        files.push({ path: change.path, untracked: true, diffAvailable: false });
      }
      continue;
    }

    const stagedAvailable = !change.staged || await isAvailableDiffPath(
      projectRoot,
      change.path,
      change.staged,
      getProjectFileImpl
    );
    const unstagedAvailable = !change.unstaged || await isAvailableDiffPath(
      projectRoot,
      change.path,
      change.unstaged,
      getProjectFileImpl
    );

    if (!stagedAvailable && !unstagedAvailable) {
      continue;
    }

    const file = { path: change.path };

    try {
      if (change.staged && stagedAvailable) {
        const { stdout } = await runGit(execFileImpl, projectRoot, [
          "diff", "--no-ext-diff", "--no-color", "--no-renames", "--unified=3", "--cached", "--", change.path,
        ]);
        const patch = parseGitPatch(stdout);
        file.staged = createState(change.staged, patch);
        truncated ||= patch.truncated;
      }

      if (change.unstaged && unstagedAvailable) {
        const { stdout } = await runGit(execFileImpl, projectRoot, [
          "diff", "--no-ext-diff", "--no-color", "--no-renames", "--unified=3", "--", change.path,
        ]);
        const patch = parseGitPatch(stdout);
        file.unstaged = createState(change.unstaged, patch);
        truncated ||= patch.truncated;
      }
    } catch (error) {
      console.error("Git diff inspection failed:", error.message);
      return failure("Could not inspect the project Git diff.");
    }

    files.push(file);
  }

  const result = {
    success: true,
    files,
    truncated,
    summary: getSummary(files),
  };

  if (!requestedPath) {
    result.presentation = createDiffPresentation(files, truncated);
  }

  if (truncated) {
    result.truncation = "Only the first 8 changed files and first 2 bounded hunks per staged or unstaged change are included.";
  }

  return result;
}
