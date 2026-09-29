export async function getGitHistory() {
  try {
    const response = await fetch("/api/developer/git-history", { method: "POST" });
    const result = await response.json();
    return response.ok && result.success
      ? result
      : result?.error ? result : { success: false, error: "Could not inspect the recent project Git history." };
  } catch (error) {
    console.error("Git history tool failed");
    return { success: false, error: "Could not inspect the recent project Git history." };
  }
}

export async function getCommitDiff(reference) {
  try {
    const response = await fetch("/api/developer/commit-diff", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference }),
    });
    const result = await response.json();
    return response.ok && result.success
      ? result
      : result?.error ? result : { success: false, error: "Could not inspect that recent project commit." };
  } catch (error) {
    console.error("Commit diff tool failed");
    return { success: false, error: "Could not inspect that recent project commit." };
  }
}
