export async function getGitStatus() {
  try {
    console.log("Git status tool started");

    const response = await fetch("/api/developer/git-status", {
      method: "POST",
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error("Git status request failed");
    }

    console.log("Git status tool completed");
    return result;
  } catch (error) {
    console.error("Git status tool failed");
    return {
      success: false,
      error: "Could not inspect the project Git status.",
    };
  }
}
