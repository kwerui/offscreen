import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openProjectFile } from "../project-vscode.js";

async function createProjectFixture() {
  const projectRoot = await mkdtemp(join(tmpdir(), "offscreen-project-vscode-"));
  const outsideRoot = await mkdtemp(join(tmpdir(), "offscreen-outside-"));

  await mkdir(join(projectRoot, "public"));
  await writeFile(join(projectRoot, "server.js"), "export const server = true;\n");
  await writeFile(join(projectRoot, "public", "app.js"), "export const app = true;\n");
  await writeFile(join(projectRoot, ".env"), "SECRET=value");
  await writeFile(join(projectRoot, "binary.dat"), Buffer.from([0, 1, 2, 3]));
  await writeFile(join(outsideRoot, "outside.js"), "export const outside = true;");
  await symlink(join(outsideRoot, "outside.js"), join(projectRoot, "outside-link.js"));

  return { projectRoot, outsideRoot };
}

async function withProjectFixture(runTest) {
  const fixture = await createProjectFixture();

  try {
    await runTest(fixture);
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
    await rm(fixture.outsideRoot, { recursive: true, force: true });
  }
}

function createSuccessfulLauncher(calls) {
  return (executable, argumentsList, options) => {
    calls.push({ executable, argumentsList, options });
    const child = new EventEmitter();
    child.unref = () => { child.unrefCalled = true; };
    queueMicrotask(() => child.emit("spawn"));
    return child;
  };
}

test("opens allowed project files with the fixed VS Code CLI without a shell", async () => {
  await withProjectFixture(async ({ projectRoot }) => {
    const calls = [];
    const result = await openProjectFile({
      projectRoot,
      path: "public/app.js",
      launcher: createSuccessfulLauncher(calls),
    });

    assert.deepEqual(result, { success: true, path: "public/app.js" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].executable, "code");
    assert.deepEqual(calls[0].argumentsList, [join(await realpath(projectRoot), "public", "app.js")]);
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].options.stdio, "ignore");
    assert.deepEqual(Object.keys(calls[0].options.env), ["PATH"]);
  });
});

test("opens a validated line through the fixed VS Code goto invocation", async () => {
  await withProjectFixture(async ({ projectRoot }) => {
    const calls = [];
    const result = await openProjectFile({
      projectRoot,
      path: "server.js",
      line: 120,
      launcher: createSuccessfulLauncher(calls),
    });

    assert.deepEqual(result, { success: true, path: "server.js", line: 120 });
    assert.deepEqual(calls[0].argumentsList, ["--goto", `${join(await realpath(projectRoot), "server.js")}:120`]);
  });
});

test("rejects unsafe, unavailable, denied, binary, and non-file targets", async () => {
  await withProjectFixture(async ({ projectRoot }) => {
    for (const path of [
      "/etc/passwd",
      "../outside.js",
      "outside-link.js",
      ".env",
      "binary.dat",
      "public",
      "missing.js",
      "x".repeat(513),
      "bad\0path",
    ]) {
      const result = await openProjectFile({ projectRoot, path, launcher: createSuccessfulLauncher([]) });
      assert.equal(result.success, false, path);
      assert.doesNotMatch(JSON.stringify(result), /\/tmp\/|\.env|outside-link|binary\.dat|missing\.js/);
    }
  });
});

test("rejects malformed and out-of-range line numbers without launching VS Code", async () => {
  await withProjectFixture(async ({ projectRoot }) => {
    for (const line of [0, -1, 1.5, "12", null, 100_001]) {
      const calls = [];
      const result = await openProjectFile({
        projectRoot,
        path: "server.js",
        line,
        launcher: createSuccessfulLauncher(calls),
      });

      assert.deepEqual(result, { success: false, error: "invalid_line" });
      assert.equal(calls.length, 0);
    }
  });
});

test("normalizes unavailable and failed VS Code launches without leaking system details", async () => {
  await withProjectFixture(async ({ projectRoot }) => {
    const unavailableLauncher = () => {
      const child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => child.emit("error", Object.assign(new Error("spawn code ENOENT /private/path"), { code: "ENOENT" })));
      return child;
    };
    const failedLauncher = () => {
      throw new Error("permission denied /private/path");
    };

    assert.deepEqual(await openProjectFile({ projectRoot, path: "server.js", launcher: unavailableLauncher }), {
      success: false,
      error: "vscode_unavailable",
    });
    assert.deepEqual(await openProjectFile({ projectRoot, path: "server.js", launcher: failedLauncher }), {
      success: false,
      error: "open_failed",
    });
  });
});
