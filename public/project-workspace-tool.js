async function requestProjectWorkspace(path, body, errorMessage) {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error("Project workspace request failed");
    }

    return result;
  } catch {
    return { success: false, error: errorMessage };
  }
}

export function searchProject(query) {
  return requestProjectWorkspace(
    "/api/developer/search",
    { query },
    "Could not search the project."
  );
}

export function readProjectFile(path, startLine, endLine) {
  const body = { path };

  if (startLine !== undefined) {
    body.start_line = startLine;
  }

  if (endLine !== undefined) {
    body.end_line = endLine;
  }

  return requestProjectWorkspace(
    "/api/developer/read-file",
    body,
    "Could not read the project file."
  );
}
