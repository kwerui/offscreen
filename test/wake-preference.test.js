import assert from "node:assert/strict";
import test from "node:test";
import {
  loadWakePreference,
  saveWakePreference,
} from "../public/wake-preference.js";

test("persists an explicitly enabled wake phrase preference", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  saveWakePreference(true, storage);

  assert.equal(loadWakePreference(storage), true);
});

test("defaults wake phrase to disabled and tolerates unavailable storage", () => {
  assert.equal(loadWakePreference({ getItem: () => null }), false);
  assert.doesNotThrow(() => saveWakePreference(true, { setItem: () => { throw new Error("blocked"); } }));
  assert.equal(loadWakePreference({ getItem: () => { throw new Error("blocked"); } }), false);
});
