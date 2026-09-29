import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const confirmationTestPage = await readFile(
  new URL("../public/browser-confirmation-test.html", import.meta.url),
  "utf8"
);

test("provides harmless consequential and ordinary controls for live confirmation checks", () => {
  assert.match(confirmationTestPage, /Delete item/);
  assert.match(confirmationTestPage, /Submit/);
  assert.match(confirmationTestPage, /Send/);
  assert.match(confirmationTestPage, /Buy/);
  assert.match(confirmationTestPage, /Ordinary link/);
  assert.match(confirmationTestPage, /ran \$\{count\} time\(s\)/);
});
