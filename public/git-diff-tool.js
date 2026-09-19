export async function getGitDiff(path) {
  try {
    const body = path === undefined ? undefined : JSON.stringify({ path });
    const response = await fetch("/api/developer/git-diff", body === undefined
      ? { method: "POST" }
      : {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

    if (!response.ok) {
      const result = await response.json();
      if (result?.success === false && result.terminal === true &&
        ["path_denied", "path_unavailable", "invalid_path", "no_changes"].includes(result.error)) {
        return result;
      }
      throw new Error("Git diff request failed");
    }

    return await response.json();
  } catch (error) {
    console.error("Git diff tool failed");
    return {
      success: false,
      error: "Could not inspect the project Git diff.",
    };
  }
}
