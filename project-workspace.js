import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";

const MAX_QUERY_CHARACTERS = 200;
const MAX_PATH_CHARACTERS = 512;
const MAX_MATCHES = 50;
const MAX_SNIPPET_CHARACTERS = 240;
const MAX_SEARCH_FILE_BYTES = 512 * 1024;
const MAX_READ_FILE_BYTES = 128 * 1024;
const DEFAULT_READ_LINES = 120;
const MAX_READ_LINES = 200;

const DENIED_DIRECTORY_NAMES = new Set([".git", "node_modules"]);
const DENIED_FILE_NAMES = new Set([
  "credentials.json",
  "token.json",
  "offscreen.zip",
  ".npmrc",
  ".netrc",
  ".pypirc",
  ".envrc",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
]);
const DENIED_FILE_EXTENSIONS = new Set([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".crt",
  ".cer",
  ".der",
]);
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

function failure(error) {
  return { success: false, error };
}

function isDeniedPath(relativePath) {
  const segments = relativePath.split("/");
  const fileName = segments.at(-1).toLowerCase();

  if (segments.some((segment) => DENIED_DIRECTORY_NAMES.has(segment.toLowerCase()))) {
    return true;
  }

  if (fileName === ".env" || fileName.startsWith(".env.")) {
    return true;
  }

  if (DENIED_FILE_NAMES.has(fileName)) {
    return true;
  }

  const extension = fileName.includes(".")
    ? `.${fileName.split(".").at(-1)}`
    : "";

  if (DENIED_FILE_EXTENSIONS.has(extension)) {
    return true;
  }

  return /(?:secret|credential|token|password|private)[._-]?(?:key|keys)?/i.test(fileName) ||
    /(?:^|[._-])(?:api|access|secret|private)?[._-]?keys?(?:$|[._-])/i.test(fileName);
}

function normalizeRelativePath(path) {
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_PATH_CHARACTERS) {
    return null;
  }

  if (
    path.includes("\0") ||
    isAbsolute(path) ||
    win32.isAbsolute(path) ||
    /^[a-zA-Z]:/.test(path) ||
    path.split(/[\\/]/).includes("..")
  ) {
    return null;
  }

  return path.split("\\").join("/");
}

async function getProjectRoot(projectRoot) {
  try {
    return await realpath(projectRoot);
  } catch {
    return null;
  }
}

async function getProjectFile(projectRoot, requestedPath) {
  const relativePath = normalizeRelativePath(requestedPath);
  const resolvedRoot = await getProjectRoot(projectRoot);

  if (!relativePath || !resolvedRoot || isDeniedPath(relativePath)) {
    return null;
  }

  const absolutePath = resolve(resolvedRoot, relativePath);
  const relativeToRoot = relative(resolvedRoot, absolutePath);

  if (relativeToRoot.startsWith("..") || relativeToRoot === "" || absolutePath === resolvedRoot) {
    return null;
  }

  try {
    const fileStatus = await lstat(absolutePath);

    if (!fileStatus.isFile() || fileStatus.isSymbolicLink()) {
      return null;
    }

    const resolvedFilePath = await realpath(absolutePath);

    if (resolvedFilePath !== absolutePath || !resolvedFilePath.startsWith(`${resolvedRoot}${sep}`)) {
      return null;
    }

    return { absolutePath, relativePath, size: fileStatus.size };
  } catch {
    return null;
  }
}

function decodeText(buffer) {
  if (buffer.includes(0)) {
    return null;
  }

  try {
    return TEXT_DECODER.decode(buffer);
  } catch {
    return null;
  }
}

function createSnippet(line, query) {
  if (line.length <= MAX_SNIPPET_CHARACTERS) {
    return line;
  }

  const queryIndex = line.indexOf(query);
  const start = Math.max(0, queryIndex - Math.floor(MAX_SNIPPET_CHARACTERS / 3));
  const end = Math.min(line.length, start + MAX_SNIPPET_CHARACTERS);
  return line.slice(start, end);
}

async function walkProjectFiles(projectRoot, directoryPath = "") {
  const absoluteDirectory = resolve(projectRoot, directoryPath);
  let entries;

  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];

  for (const entry of entries) {
    const relativePath = directoryPath ? `${directoryPath}/${entry.name}` : entry.name;

    if (entry.isSymbolicLink() || isDeniedPath(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...await walkProjectFiles(projectRoot, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

export async function searchProject({ projectRoot, query }) {
  if (typeof query !== "string" || query.trim().length === 0) {
    return failure("Search query is required.");
  }

  if (query.length > MAX_QUERY_CHARACTERS) {
    return failure("Search query is too long.");
  }

  const resolvedRoot = await getProjectRoot(projectRoot);

  if (!resolvedRoot) {
    return failure("Could not search the configured project.");
  }

  const matches = [];
  let truncated = false;
  const addMatch = (match) => {
    if (matches.length >= MAX_MATCHES) {
      truncated = true;
      return false;
    }

    matches.push(match);
    return true;
  };

  for (const path of await walkProjectFiles(resolvedRoot)) {
    if (path.includes(query) && !addMatch({ path })) {
      break;
    }

    const projectFile = await getProjectFile(resolvedRoot, path);

    if (!projectFile || projectFile.size > MAX_SEARCH_FILE_BYTES) {
      continue;
    }

    let content;
    try {
      content = decodeText(await readFile(projectFile.absolutePath));
    } catch {
      continue;
    }

    if (content === null) {
      continue;
    }

    for (const [index, line] of content.split(/\r?\n/).entries()) {
      if (line.includes(query) && !addMatch({
        path,
        line: index + 1,
        snippet: createSnippet(line, query),
      })) {
        break;
      }
    }

    if (truncated) {
      break;
    }
  }

  return { success: true, query, matches, truncated };
}

export async function readProjectFile({ projectRoot, path, startLine, endLine }) {
  const projectFile = await getProjectFile(projectRoot, path);

  if (!projectFile) {
    return failure("This project path is unavailable.");
  }

  if (projectFile.size > MAX_READ_FILE_BYTES) {
    return failure("This project file is too large to read.");
  }

  if ((startLine === undefined) !== (endLine === undefined) ||
    (startLine !== undefined && (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine))) {
    return failure("The requested line range is invalid.");
  }

  if (startLine !== undefined && endLine - startLine + 1 > MAX_READ_LINES) {
    return failure("The requested line range is too large.");
  }

  let content;
  try {
    content = decodeText(await readFile(projectFile.absolutePath));
  } catch {
    return failure("Could not read the requested project file.");
  }

  if (content === null) {
    return failure("This project file is not text.");
  }

  const lineEndings = content.match(/\r\n|\n|\r/g) ?? [];
  const lines = content.split(/\r\n|\n|\r/);
  if (/\r\n$|\n$|\r$/.test(content)) {
    lines.pop();
  }

  const actualStartLine = startLine ?? 1;
  const actualEndLine = Math.min(endLine ?? DEFAULT_READ_LINES, lines.length);

  if (actualStartLine > lines.length) {
    return failure("The requested line range is invalid.");
  }

  const selectedLines = lines.slice(actualStartLine - 1, actualEndLine);
  const selectedContent = selectedLines.map((line, index) => {
    const lineIndex = actualStartLine - 1 + index;
    const isLastSelectedLine = index === selectedLines.length - 1;

    return isLastSelectedLine ? line : `${line}${lineEndings[lineIndex]}`;
  }).join("");

  return {
    success: true,
    path: projectFile.relativePath,
    startLine: actualStartLine,
    endLine: actualEndLine,
    totalLines: lines.length,
    content: selectedContent,
    truncated: actualStartLine > 1 || actualEndLine < lines.length,
  };
}
