import assert from "node:assert/strict";
import test from "node:test";
import { openProjectFile, readProjectFile, searchProject } from "../public/project-workspace-tool.js";
import { runProjectTests } from "../public/project-tests-tool.js";

async function withMockFetch(mockFetch, runTest) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    await runTest();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("sends only bounded search and read arguments to fixed developer routes", async () => {
  const requests = [];

  await withMockFetch(async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ success: true }) };
  }, async () => {
    await searchProject("pendingBrowserConfirmation");
    await readProjectFile("git-status.js", 1, 25);
  });

  assert.deepEqual(requests, [
    {
      url: "/api/developer/search",
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "pendingBrowserConfirmation" }),
      },
    },
    {
      url: "/api/developer/read-file",
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "git-status.js", start_line: 1, end_line: 25 }),
      },
    },
  ]);
});

test("sends only bounded file opening arguments to the fixed developer route", async () => {
  await withMockFetch(async (url, options) => {
    assert.equal(url, "/api/developer/open-file");
    assert.deepEqual(options, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "server.js", line: 120 }),
    });
    return { ok: true, json: async () => ({ success: true, path: "server.js", line: 120 }) };
  }, async () => {
    assert.deepEqual(await openProjectFile("server.js", 120), {
      success: true,
      path: "server.js",
      line: 120,
    });
  });
});

test("normalizes project file opening HTTP and network failures", async () => {
  await withMockFetch(async () => ({ ok: false, json: async () => ({ error: "detail" }) }), async () => {
    assert.deepEqual(await openProjectFile("server.js"), {
      success: false,
      error: "Could not open the project file in VS Code.",
    });
  });
});

test("preserves normalized terminal VS Code validation failures without retrying", async () => {
  await withMockFetch(async () => ({
    ok: false,
    json: async () => ({ success: false, error: "file_not_allowed" }),
  }), async () => {
    assert.deepEqual(await openProjectFile(".env"), {
      success: false,
      error: "file_not_allowed",
      terminal: true,
    });
  });
});

test("runs project tests through the fixed route with no command arguments", async () => {
  const expectedResult = { success: true, completed: true, passed: true };

  await withMockFetch(async (url, options) => {
    assert.equal(url, "/api/developer/tests");
    assert.deepEqual(options, { method: "POST" });
    return { ok: true, json: async () => expectedResult };
  }, async () => {
    assert.deepEqual(await runProjectTests(), expectedResult);
  });
});

test("normalizes project test HTTP and network failures", async () => {
  await withMockFetch(async () => ({ ok: false, json: async () => ({ error: "detail" }) }), async () => {
    assert.deepEqual(await runProjectTests(), {
      success: false,
      completed: false,
      error: "Could not run the project tests.",
      errorCode: "test_runner_failed",
    });
  });
});

test("forwards each supplied line bound so the backend can reject one-sided ranges", async () => {
  const requests = [];

  await withMockFetch(async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const hasOneSidedRange = (body.start_line === undefined) !== (body.end_line === undefined);

    return {
      ok: !hasOneSidedRange,
      json: async () => hasOneSidedRange
        ? { success: false, error: "The requested line range is invalid." }
        : { success: true },
    };
  }, async () => {
    assert.deepEqual(await readProjectFile("file.js", 1), {
      success: false,
      error: "Could not read the project file.",
    });
    assert.deepEqual(await readProjectFile("file.js", undefined, 20), {
      success: false,
      error: "Could not read the project file.",
    });
    assert.deepEqual(await readProjectFile("file.js", 1, 20), { success: true });
    assert.deepEqual(await readProjectFile("file.js"), { success: true });
  });

  assert.deepEqual(requests, [
    { path: "file.js", start_line: 1 },
    { path: "file.js", end_line: 20 },
    { path: "file.js", start_line: 1, end_line: 20 },
    { path: "file.js" },
  ]);
});

test("normalizes project workspace HTTP and network failures", async () => {
  await withMockFetch(async () => ({ ok: false, json: async () => ({ error: "detail" }) }), async () => {
    assert.deepEqual(await searchProject("needle"), {
      success: false,
      error: "Could not search the project.",
    });
  });

  await withMockFetch(async () => { throw new Error("network unavailable"); }, async () => {
    assert.deepEqual(await readProjectFile("file.js"), {
      success: false,
      error: "Could not read the project file.",
    });
  });
});
