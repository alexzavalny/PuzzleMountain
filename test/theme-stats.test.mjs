import test from "node:test";
import assert from "node:assert/strict";
import { formatThemeLabel, recordThemeOutcome, summarizeThemeStats } from "../src/theme-stats.mjs";

test("formatThemeLabel humanizes mixed naming styles", () => {
  assert.equal(formatThemeLabel("backRankMate"), "Back Rank Mate");
  assert.equal(formatThemeLabel("arabian_mate"), "Arabian Mate");
  assert.equal(formatThemeLabel("double-check"), "Double Check");
});

test("recordThemeOutcome increments solved and failed counts immutably", () => {
  const stats = {
    fork: { solved: 2, failed: 1 }
  };

  const next = recordThemeOutcome(stats, ["fork", "mateInTwo"], "solved");

  assert.deepEqual(stats, {
    fork: { solved: 2, failed: 1 }
  });
  assert.deepEqual(next, {
    fork: { solved: 3, failed: 1 },
    mateInTwo: { solved: 1, failed: 0 }
  });
});

test("summarizeThemeStats splits strong and weak themes with stable ordering", () => {
  const stats = {
    fork: { solved: 5, failed: 1 },
    pin: { solved: 1, failed: 4 },
    skewer: { solved: 3, failed: 3 }
  };

  const { strongThemes, weakThemes } = summarizeThemeStats(stats);

  assert.deepEqual(
    strongThemes.map((theme) => theme.theme),
    ["fork"]
  );
  assert.deepEqual(
    weakThemes.map((theme) => theme.theme),
    ["pin", "skewer"]
  );
});
