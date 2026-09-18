export const APPLICATION_MODES = Object.freeze({
  LOCAL: "LOCAL",
  HOSTED_DEMO: "HOSTED_DEMO",
});

const LOCAL_CAPABILITIES = Object.freeze({
  isHostedDemo: false,
  calendar: true,
  codex: true,
  browserControl: true,
});

const HOSTED_DEMO_CAPABILITIES = Object.freeze({
  isHostedDemo: true,
  calendar: false,
  codex: false,
  browserControl: false,
});

export function getCapabilities(mode) {
  if (
    mode === undefined ||
    mode === "" ||
    mode === APPLICATION_MODES.LOCAL
  ) {
    return LOCAL_CAPABILITIES;
  }

  if (mode === APPLICATION_MODES.HOSTED_DEMO) {
    return HOSTED_DEMO_CAPABILITIES;
  }

  throw new Error(
    "Invalid OFFSCREEN_MODE. Use LOCAL or HOSTED_DEMO, or leave it unset."
  );
}

export function getClientCapabilities(mode) {
  const capabilities = getCapabilities(mode);

  return {
    isHostedDemo: capabilities.isHostedDemo,
    calendar: capabilities.calendar,
    codex: capabilities.codex,
    browserControl: capabilities.browserControl,
  };
}

export function getRuntimeCapabilities(runtimeCapabilities) {
  if (
    runtimeCapabilities?.isHostedDemo === false &&
    runtimeCapabilities.calendar === true &&
    runtimeCapabilities.codex === true &&
    runtimeCapabilities.browserControl === true
  ) {
    return LOCAL_CAPABILITIES;
  }

  if (
    runtimeCapabilities?.isHostedDemo === true &&
    runtimeCapabilities.calendar === false &&
    runtimeCapabilities.codex === false &&
    runtimeCapabilities.browserControl === false
  ) {
    return HOSTED_DEMO_CAPABILITIES;
  }

  return HOSTED_DEMO_CAPABILITIES;
}
