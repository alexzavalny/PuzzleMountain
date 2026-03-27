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

test("stopwatch is visible in the sidebar and can be toggled from settings", async () => {
  const indexHtml = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");

  assert.match(indexHtml, /<div id="stopwatch-panel" class="stopwatch-panel">/);
  assert.match(indexHtml, /<p id="stopwatch-value" class="stopwatch-value" aria-live="off">00:00<\/p>/);
  assert.match(
    indexHtml,
    /<label class="settings-option" for="stopwatch-toggle" role="menuitemcheckbox" aria-checked="true">[\s\S]*<input id="stopwatch-toggle" class="toggle-chip-input" type="checkbox" checked>/
  );
});
