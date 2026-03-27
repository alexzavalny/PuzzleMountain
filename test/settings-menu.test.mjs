import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("sound debug action lives inside the settings dropdown", async () => {
  const indexHtml = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(
    indexHtml,
    /<div id="settings-dropdown"[\s\S]*<button id="sound-debug-button" class="settings-option settings-action"/
  );
  assert.doesNotMatch(indexHtml, /<button id="sound-debug-button" class="secondary"/);
});
