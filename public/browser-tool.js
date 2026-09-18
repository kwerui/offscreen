export async function runBrowserTool(action, input = {}) {
  try {
    const response = await fetch("/api/browser", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, ...input }),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return {
        success: false,
        error: data.error || "Browser action failed",
        ...(data.errorCode ? { errorCode: data.errorCode } : {}),
      };
    }

    return {
      success: true,
      content: data.content,
    };
  } catch {
    console.error("Browser tool failed");
    return { success: false, error: "Browser action failed" };
  }
}
