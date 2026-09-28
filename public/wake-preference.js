const WAKE_PREFERENCE_KEY = "offscreen.voiceWakeEnabled";

export function loadWakePreference(storage = getLocalStorage()) {
  try {
    return storage?.getItem(WAKE_PREFERENCE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveWakePreference(enabled, storage = getLocalStorage()) {
  try {
    storage?.setItem(WAKE_PREFERENCE_KEY, enabled ? "true" : "false");
  } catch {
    // Storage can be unavailable in private or policy-restricted contexts.
  }
}

function getLocalStorage() {
  if (typeof window === "undefined" || !("localStorage" in window)) {
    return undefined;
  }

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
