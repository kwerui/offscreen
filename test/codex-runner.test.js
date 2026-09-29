import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createCodexEnvironment,
  createCodexInspectionWorkspace,
  removeCodexInspectionWorkspace,
} from "../codex-runner.js";

test("passes only the Codex runtime environment allowlist", () => {
  const codexEnvironment = createCodexEnvironment({
    PATH: "/usr/bin",
    HOME: "/Users/example",
    CODEX_HOME: "/Users/example/.codex",
    TMPDIR: "/tmp/example",
    USERPROFILE: "C:\\Users\\example",
    APPDATA: "not-forwarded",
    LOCALAPPDATA: "not-forwarded",
    ASSEMBLYAI_API_KEY: "not-forwarded",
    GOOGLE_CLIENT_SECRET: "not-forwarded",
    ARBITRARY_DOTENV_VALUE: "not-forwarded",
  });

  assert.deepEqual(codexEnvironment, {
    PATH: "/usr/bin",
    HOME: "/Users/example",
    CODEX_HOME: "/Users/example/.codex",
    TMPDIR: "/tmp/example",
    USERPROFILE: "C:\\Users\\example",
  });
});

test("uses server.js's directory as the Codex inspection source", async () => {
  const serverSource = await readFile(new URL("../server.js", import.meta.url), "utf8");

  assert.match(
    serverSource,
    /createCodexInspectionWorkspace\(__dirname\)/
  );
  assert.doesNotMatch(
    serverSource,
    /createCodexInspectionWorkspace\(process\.cwd\(\)\)/
  );
});

test("copies source files while excluding local credential files and symlinks", async () => {
  const repositoryPath = await mkdtemp(join(tmpdir(), "offscreen-codex-test-"));
  let inspectionWorkspace;

  try {
    await writeFile(join(repositoryPath, "source.js"), "export default 1;\n");
    await writeFile(join(repositoryPath, ".env"), "private\n");
    await writeFile(join(repositoryPath, "credentials.json"), "private\n");
    await writeFile(join(repositoryPath, "token.json"), "private\n");
    await writeFile(join(repositoryPath, "private.key"), "private\n");
    await writeFile(join(repositoryPath, "repository-backup.zip"), "private\n");
    await symlink(join(repositoryPath, ".env"), join(repositoryPath, "linked-source.js"));

    inspectionWorkspace = await createCodexInspectionWorkspace(repositoryPath);

    assert.equal(
      await readFile(join(inspectionWorkspace, "source.js"), "utf8"),
      "export default 1;\n"
    );

    for (const excludedFile of [
      ".env",
      "credentials.json",
      "token.json",
      "private.key",
      "repository-backup.zip",
      "linked-source.js",
    ]) {
      await assert.rejects(readFile(join(inspectionWorkspace, excludedFile)));
    }
  } finally {
    if (inspectionWorkspace) {
      await removeCodexInspectionWorkspace(inspectionWorkspace);
    }
    await rm(repositoryPath, { recursive: true, force: true });
  }
});
