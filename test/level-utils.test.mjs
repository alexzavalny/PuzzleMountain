import test from "node:test";
import assert from "node:assert/strict";
import { clampLevel, levelForBand, normalizedBandForLevel, rangeMaxForBand } from "../src/lib/level-utils.mjs";

test("clampLevel normalizes invalid, fractional, and oversized values", () => {
  assert.equal(clampLevel("not-a-number"), 0);
  assert.equal(clampLevel(-3), 0);
  assert.equal(clampLevel(4.9), 4);
  assert.equal(clampLevel(99, 10), 10);
});

test("levelForBand and rangeMaxForBand derive the visible level range", () => {
  assert.equal(levelForBand(350), 7);
  assert.equal(levelForBand(1850), 37);
  assert.equal(rangeMaxForBand(1850), 1899);
});

test("normalizedBandForLevel respects available bands and configured max level", () => {
  const metadata = {
    bandSize: 50,
    lowestBand: 350,
    availableBands: [350, 400, 450, 550, 600]
  };

  assert.equal(normalizedBandForLevel({ level: 0, metadata, maxLevel: 66 }), 350);
  assert.equal(normalizedBandForLevel({ level: 9, metadata, maxLevel: 66 }), 450);
  assert.equal(normalizedBandForLevel({ level: 20, metadata, maxLevel: 11 }), 550);
});
