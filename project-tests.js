import { execFile } from "node:child_process";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_TEST_COMMAND = Object.freeze({
  executable: "npm",
  arguments: Object.freeze(["test"]),
});
export const PROJECT_TEST_TIMEOUT_MS = 60_000;
export const PROJECT_TEST_MAX_BUFFER_BYTES = 128 * 1024;

const MAX_FAILURES = 10;
const MAX_FAILURE_NAME_CHARACTERS = 240;
const MAX_FAILURE_FILE_CHARACTERS = 512;
const MAX_FAILURE_MESSAGE_CHARACTERS = 1_000;

export function createProjectTestEnvironment(sourceEnvironment = process.env) {
  return { PATH: sourceEnvironment.PATH ?? "" };
}

function parseCount(output, name) {
  const match = output.match(new RegExp(`^\\s*(?:(?:ℹ|#)\\s+)?${name}\\s+(\\d+)\\s*$`, "mi"));
  return match ? Number(match[1]) : undefined;
}

function parseDuration(output) {
  const match = output.match(/^\s*(?:(?:ℹ|#)\s+)?duration_ms\s+([\d.]+)\s*$/mi);
  return match ? Number(match[1]) : undefined;
}

function getSafeRelativePath(value, projectRoot) {
  let filePath = value;

  try {
    if (filePath.startsWith("file:")) {
      filePath = fileURLToPath(filePath);
    }
  } catch {
    return null;
  }

  if (!filePath.startsWith(sep)) {
    return null;
  }

  const relativePath = relative(resolve(projectRoot), filePath);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    return null;
  }

  return relativePath.split(sep).join("/");
}

function removeAbsolutePaths(message, projectRoot) {
  return message.replace(/file:\/\/[^\s):]+|\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.@-]+)+/g, (path) => {
    const safePath = getSafeRelativePath(path, projectRoot);
    return safePath ?? "[path removed]";
  });
}

function truncateValue(value, maximumLength) {
  if (value.length <= maximumLength) {
    return { value, truncated: false };
  }

  return { value: value.slice(0, maximumLength), truncated: true };
}

function getFailureFile(lines, projectRoot) {
  for (const line of lines) {
    const match = line.match(/(file:\/\/[^\s):]+|\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.@-]+)+)(?::(\d+):(\d+))?/);
    if (!match) {
      continue;
    }

    const safePath = getSafeRelativePath(match[1], projectRoot);
    if (safePath) {
      return truncateValue(
        match[2] ? `${safePath}:${match[2]}:${match[3]}` : safePath,
        MAX_FAILURE_FILE_CHARACTERS
      );
    }
  }

  return { value: undefined, truncated: false };
}

function getFailureMessage(lines, projectRoot) {
  const messageLines = [];
  let isYamlErrorBlock = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("at ") || /^location:/.test(trimmedLine)) {
      continue;
    }

    if (/^stack:/.test(trimmedLine)) {
      break;
    }

    if (/^error:\s*\|-?$/.test(trimmedLine)) {
      messageLines.length = 0;
      isYamlErrorBlock = true;
      continue;
    }

    if (isYamlErrorBlock && trimmedLine === "...") {
      break;
    }

    messageLines.push(trimmedLine);
  }

  const message = removeAbsolutePaths(messageLines.join("\n"), projectRoot).trim();

  if (!message) {
    return { value: undefined, truncated: false };
  }

  return truncateValue(message, MAX_FAILURE_MESSAGE_CHARACTERS);
}

function parseFailures(output, projectRoot) {
  const lines = output.split(/\r?\n/);
  const failures = [];
  let failureName;
  let failureLines = [];
  let omittedFailures = false;
  let hasTruncatedDetail = false;

  function addFailure() {
    if (!failureName) {
      return;
    }

    if (failures.length >= MAX_FAILURES) {
      omittedFailures = true;
    } else {
      const name = truncateValue(failureName, MAX_FAILURE_NAME_CHARACTERS);
      const failure = { name: name.value };
      const file = getFailureFile(failureLines, projectRoot);
      const message = getFailureMessage(failureLines, projectRoot);

      hasTruncatedDetail ||= name.truncated || file.truncated || message.truncated;

      if (file.value) {
        failure.file = file.value;
      }
      if (message.value) {
        failure.message = message.value;
      }

      failures.push(failure);
    }

    failureName = undefined;
    failureLines = [];
  }

  for (const line of lines) {
    const failureMatch = line.match(/^\s*(?:✖\s+|not ok\s+\d+\s+-\s+)(.+?)(?:\s+\([\d.]+m?s\))?\s*$/);
    if (failureMatch) {
      addFailure();
      failureName = failureMatch[1].trim();
      continue;
    }

    if (failureName) {
      if (/^\s*(?:(?:ℹ|#)\s+)?(?:tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\s+/i.test(line) || /^\d+\.\.\d+\s*$/.test(line)) {
        addFailure();
      } else {
        failureLines.push(line);
      }
    }
  }

  addFailure();
  return { failures, omittedFailures, hasTruncatedDetail };
}

export function parseProjectTestOutput(stdout, stderr, projectRoot) {
  const output = `${stdout}\n${stderr}`;
  const { failures, omittedFailures, hasTruncatedDetail } = parseFailures(output, projectRoot);
  const failedCount = parseCount(output, "fail");

  return {
    total: parseCount(output, "tests"),
    passedCount: parseCount(output, "pass"),
    failedCount,
    skippedCount: parseCount(output, "skipped"),
    durationMs: parseDuration(output),
    failures,
    truncated: omittedFailures || hasTruncatedDetail ||
      (Number.isInteger(failedCount) && failures.length < failedCount),
  };
}

function hasCompletedTestSummary(parsed) {
  return Number.isInteger(parsed.failedCount) && parsed.failedCount > 0;
}

function createSummary(parsed, passed) {
  if (!Number.isInteger(parsed.passedCount) || !Number.isInteger(parsed.failedCount)) {
    return "Project tests completed.";
  }

  if (passed) {
    return `${parsed.passedCount} test${parsed.passedCount === 1 ? "" : "s"} passed.`;
  }

  return `${parsed.passedCount} test${parsed.passedCount === 1 ? "" : "s"} passed and ${parsed.failedCount} failed.`;
}

function createCompletedResult(parsed, passed) {
  const result = {
    success: true,
    completed: true,
    passed,
    failures: parsed.failures,
    truncated: parsed.truncated,
    summary: createSummary(parsed, passed),
  };

  for (const field of ["total", "passedCount", "failedCount", "skippedCount", "durationMs"]) {
    if (parsed[field] !== undefined) {
      result[field] = parsed[field];
    }
  }

  return result;
}

function createRunnerFailure() {
  return {
    success: false,
    completed: false,
    error: "Could not run the project tests.",
    errorCode: "test_runner_failed",
  };
}

function isTimeout(error) {
  return error?.code === "ETIMEDOUT" || (error?.killed && error?.signal === "SIGTERM");
}

function terminateProjectTestProcessGroup(child) {
  if (!child?.pid) {
    return;
  }

  try {
    if (process.platform === "win32") {
      child.kill("SIGTERM");
      return;
    }

    // detached makes npm the leader of a dedicated process group, so this also
    // terminates node --test processes spawned by the configured npm script.
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // The direct child may already have exited before callback cleanup.
  }
}

function requiresProcessTreeCleanup(error) {
  return isTimeout(error) || error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
}

export function runProjectTests({
  projectRoot,
  execFileImpl = execFile,
  killProcessGroupImpl = terminateProjectTestProcessGroup,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  return new Promise((resolveResult) => {
    let child;
    let timeoutId;
    let hasSettled = false;

    function finish(result) {
      if (hasSettled) {
        return;
      }

      hasSettled = true;
      if (timeoutId) {
        clearTimeoutImpl(timeoutId);
      }
      resolveResult(result);
    }

    function handleCompletion(error, stdout = "", stderr = "") {
      if (hasSettled) {
        return;
      }

      if (requiresProcessTreeCleanup(error)) {
        killProcessGroupImpl(child);
      }

      if (isTimeout(error)) {
        finish({
          success: false,
          completed: false,
          error: "The project test run timed out.",
          errorCode: "test_runner_timeout",
        });
        return;
      }

      const parsed = parseProjectTestOutput(stdout, stderr, projectRoot);

      if (!error) {
        finish(createCompletedResult(parsed, true));
        return;
      }

      if (error.code === 1 && hasCompletedTestSummary(parsed)) {
        finish(createCompletedResult(parsed, false));
        return;
      }

      finish(createRunnerFailure());
    }

    function watchOutputLimit(stream) {
      let capturedBytes = 0;

      stream?.on?.("data", (chunk) => {
        if (hasSettled) {
          return;
        }

        capturedBytes += Buffer.byteLength(chunk);
        if (capturedBytes <= PROJECT_TEST_MAX_BUFFER_BYTES) {
          return;
        }

        killProcessGroupImpl(child);
        finish(createRunnerFailure());
      });
    }

    try {
      child = execFileImpl(
        PROJECT_TEST_COMMAND.executable,
        PROJECT_TEST_COMMAND.arguments,
        {
          cwd: projectRoot,
          env: createProjectTestEnvironment(),
          shell: false,
          detached: process.platform !== "win32",
          timeout: PROJECT_TEST_TIMEOUT_MS,
          maxBuffer: PROJECT_TEST_MAX_BUFFER_BYTES,
        },
        handleCompletion
      );
      watchOutputLimit(child?.stdout);
      watchOutputLimit(child?.stderr);
      if (!hasSettled) {
        timeoutId = setTimeoutImpl(() => {
          killProcessGroupImpl(child);
          finish({
            success: false,
            completed: false,
            error: "The project test run timed out.",
            errorCode: "test_runner_timeout",
          });
        }, PROJECT_TEST_TIMEOUT_MS);
      }
    } catch {
      finish(createRunnerFailure());
    }
  });
}
