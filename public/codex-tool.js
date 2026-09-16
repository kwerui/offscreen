export async function runCodexTask(task) {
  try {
    if (!task) {
      throw new Error("Codex task is required.");
    }

    console.log("Codex tool started");

    const response = await fetch("/api/codex", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ task }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(
        `Codex request failed with status ${response.status}: ${errorText}`
      );
    }

    const data = await response.json();

    console.log("Codex tool completed");

    return {
      success: true,
      output: data.output,
    };
  } catch (err) {
    console.error("Codex tool failed");

    return {
      success: false,
      error: err.message,
    };
  }
}
