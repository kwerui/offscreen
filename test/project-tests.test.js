import assert from "node:assert/strict";
import test from "node:test";
import {
  PROJECT_TEST_COMMAND,
  PROJECT_TEST_TIMEOUT_MS,
  PROJECT_TEST_MAX_BUFFER_BYTES,
  createProjectTestEnvironment,
  parseProjectTestOutput,
  runProjectTests,
} from "../project-tests.js";

const PASSING_OUTPUT = `✔ adds numbers (0.8ms)\nℹ tests 2\nℹ suites 0\nℹ pass 2\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 42.5\n`;

const FAILING_OUTPUT = `✖ rejects invalid input (1.2ms)\n  AssertionError [ERR_ASSERTION]: expected validation failure\n      at TestContext.<anonymous> (file:///configured/project/test/example.test.js:12:3)\n\n✖ preserves a second failure (2.1ms)\n  Error: second message\n      at file:///outside/project/test/outside.test.js:1:1\n\nℹ tests 3\nℹ suites 0\nℹ pass 1\nℹ fail 2\nℹ cancelled 0\nℹ skipped 1\nℹ todo 0\nℹ duration_ms 75.25\n`;

const TAP_PASSING_OUTPUT = `> voice-assistant-app@1.0.0 test\n> node --test\n\nTAP version 13\n# Subtest: adds numbers\nok 1 - adds numbers\n  ---\n  duration_ms: 0.8\n  ...\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n# duration_ms 42.5\n`;

const TAP_FAILING_OUTPUT = `> voice-assistant-app@1.0.0 test\n> node --test\n\nTAP version 13\n# Subtest: rejects invalid input\nnot ok 2 - rejects invalid input\n  ---\n  duration_ms: 1.2\n  type: 'test'\n  location: '/configured/project/test/example.test.js:12:1'\n  failureType: 'testCodeFailure'\n  error: |-\n    Expected values to be strictly equal\n  stack: |-\n    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal\n    at TestContext.<anonymous> (/configured/project/test/example.test.js:12:1)\n  ...\n1..2\n# tests 2\n# suites 0\n# pass 1\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 80\n`;

function runWithOutput({ error = null, stdout = "", stderr = "", options = {} }) {
  return runProjectTests({
    projectRoot: "/configured/project",
    ...options,
    execFileImpl: (file, args, execOptions, callback) => {
      callback(error, stdout, stderr);
      return { kill() {} };
    },
  });
}

test("uses only the fixed npm test command, configured cwd, no shell, and a small environment", async () => {
  let received;

  const result = await runProjectTests({
    projectRoot: "/configured/project",
    command: "ignored",
    args: ["ignored"],
    cwd: "/outside",
    env: { ASSEMBLYAI_API_KEY: "leak" },
    execFileImpl: (file, args, options, callback) => {
      received = { file, args, options };
      callback(null, PASSING_OUTPUT, "");
      return { kill() {} };
    },
  });

  assert.equal(result.success, true);
  assert.deepEqual(received.file, PROJECT_TEST_COMMAND.executable);
  assert.deepEqual(received.args, PROJECT_TEST_COMMAND.arguments);
  assert.equal(received.options.cwd, "/configured/project");
  assert.equal(received.options.shell, false);
  assert.equal(received.options.timeout, PROJECT_TEST_TIMEOUT_MS);
  assert.equal(received.options.maxBuffer, PROJECT_TEST_MAX_BUFFER_BYTES);
  assert.deepEqual(Object.keys(received.options.env), ["PATH"]);
  assert.equal(received.options.env.ASSEMBLYAI_API_KEY, undefined);
});

test("creates a child environment that excludes Offscreen secrets", () => {
  const environment = createProjectTestEnvironment({
    PATH: "/trusted/bin",
    ASSEMBLYAI_API_KEY: "secret",
    GOOGLE_CLIENT_SECRET: "secret",
    TOKEN: "secret",
  });

  assert.deepEqual(environment, { PATH: "/trusted/bin" });
});

test("parses completed passing test output", () => {
  assert.deepEqual(parseProjectTestOutput(PASSING_OUTPUT, "", "/configured/project"), {
    total: 2,
    passedCount: 2,
    failedCount: 0,
    skippedCount: 0,
    durationMs: 42.5,
    failures: [],
    truncated: false,
  });
});

test("parses npm's TAP test footer, skipped count, and duration", () => {
  assert.deepEqual(parseProjectTestOutput(TAP_PASSING_OUTPUT, "", "/configured/project"), {
    total: 1,
    passedCount: 1,
    failedCount: 0,
    skippedCount: 1,
    durationMs: 42.5,
    failures: [],
    truncated: false,
  });
});

test("treats a TAP failing exit as completed and excludes its footer from failure details", async () => {
  const result = await runWithOutput({
    error: Object.assign(new Error("tests failed"), { code: 1 }),
    stdout: TAP_FAILING_OUTPUT,
  });

  assert.equal(result.success, true);
  assert.equal(result.completed, true);
  assert.equal(result.passed, false);
  assert.equal(result.passedCount, 1);
  assert.equal(result.failedCount, 1);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.durationMs, 80);
  assert.equal(result.failures[0].name, "rejects invalid input");
  assert.equal(result.failures[0].file, "test/example.test.js:12:1");
  assert.match(result.failures[0].message, /Expected values to be strictly equal/);
  assert.doesNotMatch(result.failures[0].message, /# tests|# pass|# fail|stack:|location:|duration_ms:|failureType:|type:/);
});

test("parses failures, skips, duration, and removes absolute paths", () => {
  const parsed = parseProjectTestOutput(FAILING_OUTPUT, "", "/configured/project");

  assert.equal(parsed.total, 3);
  assert.equal(parsed.passedCount, 1);
  assert.equal(parsed.failedCount, 2);
  assert.equal(parsed.skippedCount, 1);
  assert.equal(parsed.durationMs, 75.25);
  assert.equal(parsed.failures[0].name, "rejects invalid input");
  assert.equal(parsed.failures[0].file, "test/example.test.js:12:3");
  assert.match(parsed.failures[0].message, /expected validation failure/);
  assert.doesNotMatch(JSON.stringify(parsed), /\/configured\/project|\/outside\/project/);
});

test("bounds failure entries and failure messages while retaining aggregate counts", () => {
  const failures = Array.from({ length: 12 }, (_, index) =>
    `✖ failed ${index} (1ms)\n  Error: ${"x".repeat(1_500)}\n`
  ).join("\n");
  const output = `${failures}\nℹ tests 12\nℹ pass 0\nℹ fail 12\nℹ skipped 0\nℹ duration_ms 20\n`;
  const parsed = parseProjectTestOutput(output, "", "/configured/project");

  assert.equal(parsed.failures.length, 10);
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.failedCount, 12);
  assert.ok(parsed.failures.every((failure) => failure.message.length <= 1_000));
});

test("bounds repository-controlled failure names and locations", () => {
  const output = `✖ ${"n".repeat(1_000)} (1ms)\n  Error: message\n  at file:///configured/project/${"f".repeat(1_000)}.test.js:1:1\n\nℹ tests 1\nℹ pass 0\nℹ fail 1\n`;
  const parsed = parseProjectTestOutput(output, "", "/configured/project");

  assert.ok(parsed.failures[0].name.length <= 240);
  assert.ok(parsed.failures[0].file.length <= 512);
  assert.equal(parsed.truncated, true);
});

test("marks failure details truncated when the runner summary reports failures it did not describe", () => {
  const parsed = parseProjectTestOutput(
    "ℹ tests 2\nℹ pass 1\nℹ fail 1\nℹ skipped 0\n",
    "",
    "/configured/project"
  );

  assert.equal(parsed.failedCount, 1);
  assert.deepEqual(parsed.failures, []);
  assert.equal(parsed.truncated, true);
});

test("treats an ordinary test exit failure as a completed result", async () => {
  const result = await runWithOutput({
    error: Object.assign(new Error("tests failed"), { code: 1 }),
    stdout: FAILING_OUTPUT,
  });

  assert.deepEqual(result, {
    success: true,
    completed: true,
    passed: false,
    total: 3,
    passedCount: 1,
    failedCount: 2,
    skippedCount: 1,
    durationMs: 75.25,
    failures: result.failures,
    truncated: false,
    summary: "1 test passed and 2 failed.",
  });
});

test("normalizes timeout, oversized output, and unparseable runner failures", async () => {
  assert.deepEqual(await runWithOutput({
    error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT", killed: true }),
  }), {
    success: false,
    completed: false,
    error: "The project test run timed out.",
    errorCode: "test_runner_timeout",
  });

  assert.deepEqual(await runWithOutput({
    error: Object.assign(new Error("maxBuffer"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }),
  }), {
    success: false,
    completed: false,
    error: "Could not run the project tests.",
    errorCode: "test_runner_failed",
  });

  assert.deepEqual(await runWithOutput({
    error: Object.assign(new Error("broken"), { code: 1 }),
    stdout: "unexpected runner output",
  }), {
    success: false,
    completed: false,
    error: "Could not run the project tests.",
    errorCode: "test_runner_failed",
  });
});

test("terminates the detached project test process group after timeout or output overflow", async () => {
  const terminatedProcessGroups = [];

  for (const error of [
    Object.assign(new Error("timed out"), { code: "ETIMEDOUT", killed: true }),
    Object.assign(new Error("maxBuffer"), { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }),
  ]) {
    await runProjectTests({
      projectRoot: "/configured/project",
      killProcessGroupImpl: (child) => terminatedProcessGroups.push(child.pid),
      execFileImpl: (_file, _args, _options, callback) => {
        const child = { pid: 1234 };
        queueMicrotask(() => callback(error, "", ""));
        return child;
      },
    });
  }

  assert.deepEqual(terminatedProcessGroups, [1234, 1234]);
});

test("watchdog terminates the process group even when a timed-out npm child never closes", async () => {
  let watchdog;
  const terminatedProcessGroups = [];
  const resultPromise = runProjectTests({
    projectRoot: "/configured/project",
    killProcessGroupImpl: (child) => terminatedProcessGroups.push(child.pid),
    setTimeoutImpl: (callback, delay) => {
      assert.equal(delay, PROJECT_TEST_TIMEOUT_MS);
      watchdog = callback;
      return 1;
    },
    clearTimeoutImpl: () => {},
    execFileImpl: () => ({ pid: 4321 }),
  });

  watchdog();

  assert.deepEqual(await resultPromise, {
    success: false,
    completed: false,
    error: "The project test run timed out.",
    errorCode: "test_runner_timeout",
  });
  assert.deepEqual(terminatedProcessGroups, [4321]);
});

test("output watcher terminates the process group before overflowing descendants can keep pipes open", async () => {
  let stdoutListener;
  const terminatedProcessGroups = [];
  const resultPromise = runProjectTests({
    projectRoot: "/configured/project",
    killProcessGroupImpl: (child) => terminatedProcessGroups.push(child.pid),
    setTimeoutImpl: () => 1,
    clearTimeoutImpl: () => {},
    execFileImpl: () => ({
      pid: 5678,
      stdout: { on: (_event, listener) => { stdoutListener = listener; } },
      stderr: { on() {} },
    }),
  });

  stdoutListener(Buffer.alloc(PROJECT_TEST_MAX_BUFFER_BYTES + 1));

  assert.deepEqual(await resultPromise, {
    success: false,
    completed: false,
    error: "Could not run the project tests.",
    errorCode: "test_runner_failed",
  });
  assert.deepEqual(terminatedProcessGroups, [5678]);
});
