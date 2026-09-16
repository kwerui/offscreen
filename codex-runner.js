import { cp, lstat, mkdtemp, rm } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { tmpdir } from "node:os";

const CODEX_ENVIRONMENT_VARIABLES = [
  "PATH",
  "HOME",
  "CODEX_HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  // Windows can use USERPROFILE as the home-directory fallback.
  "USERPROFILE",
  "SYSTEMROOT",
  "COMSPEC",
  "PATHEXT",
];
const SENSITIVE_FILE_EXTENSIONS = [".key", ".pem", ".p12", ".pfx"];
const ARCHIVE_FILE_EXTENSIONS = [".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz"];
const SENSITIVE_FILE_NAMES = new Set(["credentials.json", "token.json"]);
const EXCLUDED_DIRECTORY_NAMES = new Set([".git", "node_modules"]);

export function createCodexEnvironment(serverEnvironment = process.env) {
  const codexEnvironment = {};

  for (const variableName of CODEX_ENVIRONMENT_VARIABLES) {
    const value = serverEnvironment[variableName];
    if (value) codexEnvironment[variableName] = value;
  }

  return codexEnvironment;
}

function shouldExcludeFromInspection(sourcePath, repositoryPath) {
  const pathParts = relative(repositoryPath, sourcePath).split(/[/\\]/);
  const fileName = basename(sourcePath).toLowerCase();

  if (pathParts.some((pathPart) => EXCLUDED_DIRECTORY_NAMES.has(pathPart))) {
    return true;
  }

  if (fileName === ".env" || fileName.startsWith(".env.")) {
    return true;
  }

  if (SENSITIVE_FILE_NAMES.has(fileName)) {
    return true;
  }

  return [...SENSITIVE_FILE_EXTENSIONS, ...ARCHIVE_FILE_EXTENSIONS].some(
    (extension) => fileName.endsWith(extension)
  );
}

export async function createCodexInspectionWorkspace(repositoryPath) {
  const inspectionWorkspace = await mkdtemp(join(tmpdir(), "offscreen-codex-"));

  try {
    await cp(repositoryPath, inspectionWorkspace, {
      recursive: true,
      filter: async (sourcePath) => {
        if (shouldExcludeFromInspection(sourcePath, repositoryPath)) {
          return false;
        }

        const sourceStats = await lstat(sourcePath);
        // A symlink could point out of the filtered workspace to a local secret.
        return !sourceStats.isSymbolicLink();
      },
    });
    return inspectionWorkspace;
  } catch (error) {
    await removeCodexInspectionWorkspace(inspectionWorkspace);
    throw error;
  }
}

export async function removeCodexInspectionWorkspace(inspectionWorkspace) {
  await rm(inspectionWorkspace, { recursive: true, force: true });
}
