import { ABSOLUTE_MAX_LEVEL } from "../constants.mjs";

export function clampLevel(level, maxLevel = ABSOLUTE_MAX_LEVEL) {
  const normalizedLevel = Number(level);
  if (!Number.isFinite(normalizedLevel)) {
    return 0;
  }

  return Math.min(Math.max(Math.trunc(normalizedLevel), 0), maxLevel);
}

export function levelForBand(band, maxLevel = ABSOLUTE_MAX_LEVEL) {
  return clampLevel(Math.floor(band / 50), maxLevel);
}

export function rangeMaxForBand(band) {
  return band + 49;
}

export function normalizedBandForLevel({ level, metadata, maxLevel = ABSOLUTE_MAX_LEVEL }) {
  if (!metadata) {
    throw new Error("Puzzle metadata is required to resolve a level band.");
  }

  const clampedLevel = clampLevel(level, maxLevel);
  const targetBand = clampedLevel * metadata.bandSize;

  return (
    metadata.availableBands.find((band) => band >= targetBand) ??
    metadata.availableBands.at(-1) ??
    metadata.lowestBand
  );
}
