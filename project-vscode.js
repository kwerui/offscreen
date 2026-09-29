import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import {
  decodeProjectText,
  getProjectFile,
  isDeniedProjectPath,
  normalizeProjectRelativePath,
} from "./project-workspace.js";

const VS_CODE_EXECUTABLE = "code";
const MAX_LINE_NUMBER = 100_000;
const MAX_OPEN_FILE_BYTES = 128 * 1024;

function failure(error) {
  return { success: false, error };
}

function isValidLine(line) {
  return line === undefined || (
    Number.isInteger(line) && line >= 1 && line <= MAX_LINE_NUMBER
  );
}

export function createVsCodeEnvironment(sourceEnvironment = process.env) {
  return { PATH: sourceEnvironment.PATH ?? "" };
}

function waitForLaunch(child) {
  return new Promise((resolveResult) => {
    child.once("spawn", () => resolveResult({ success: true }));
    child.once("error", (error) => {
      resolveResult({
        success: false,
        error: error?.code === "ENOENT" ? "vscode_unavailable" : "open_failed",
      });
    });
  });
}

export async function openProjectFile({
  projectRoot,
  path,
  line,
  launcher = spawn,
}) {
  const relativePath = normalizeProjectRelativePath(path);

  if (!relativePath) {
    return failure("invalid_path");
  }

  if (isDeniedProjectPath(relativePath)) {
    return failure("file_not_allowed");
  }

  if (!isValidLine(line)) {
    return failure("invalid_line");
  }

  const projectFile = await getProjectFile(projectRoot, relativePath);

  if (!projectFile) {
    return failure("file_not_allowed");
  }

  if (projectFile.size > MAX_OPEN_FILE_BYTES) {
    return failure("file_not_allowed");
  }

  try {
    if (decodeProjectText(await readFile(projectFile.absolutePath)) === null) {
      return failure("file_not_allowed");
    }
  } catch {
    return failure("file_not_found");
  }

  const argumentsList = line === undefined
    ? [projectFile.absolutePath]
    : ["--goto", `${projectFile.absolutePath}:${line}`];
  let child;

  try {
    child = launcher(VS_CODE_EXECUTABLE, argumentsList, {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
      env: createVsCodeEnvironment(),
    });
  } catch {
    return failure("open_failed");
  }

  const launchResult = await waitForLaunch(child);

  if (!launchResult.success) {
    return launchResult;
  }

  child.unref?.();
  return line === undefined
    ? { success: true, path: projectFile.relativePath }
    : { success: true, path: projectFile.relativePath, line };
}
