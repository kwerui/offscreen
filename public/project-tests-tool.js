export async function runProjectTests() {
  try {
    console.log("Project tests tool started");

    const response = await fetch("/api/developer/tests", {
      method: "POST",
    });
    const result = await response.json();

    if (!response.ok || typeof result?.success !== "boolean") {
      throw new Error("Project test request failed");
    }

    console.log("Project tests tool completed");
    return result;
  } catch {
    console.error("Project tests tool failed");
    return {
      success: false,
      completed: false,
      error: "Could not run the project tests.",
      errorCode: "test_runner_failed",
    };
  }
}
