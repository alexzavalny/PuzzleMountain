import {
  MAX_LEVEL_STORAGE_KEY,
  SOUND_ENABLED_STORAGE_KEY,
  THEME_STATS_STORAGE_KEY,
  ABSOLUTE_MAX_LEVEL
} from "./constants.mjs";
import { clampLevel } from "./lib/level-utils.mjs";

function readStorage(key, fallbackValue, parser, errorLabel) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      return fallbackValue;
    }

    return parser(raw);
  } catch (error) {
    console.warn(`[PuzzleMountain] Could not read ${errorLabel}`, error);
    return fallbackValue;
  }
}

function writeStorage(key, value, serializer, errorLabel) {
  try {
    window.localStorage.setItem(key, serializer(value));
  } catch (error) {
    console.warn(`[PuzzleMountain] Could not persist ${errorLabel}`, error);
  }
}

export function readConfiguredMaxLevel() {
  return readStorage(
    MAX_LEVEL_STORAGE_KEY,
    ABSOLUTE_MAX_LEVEL,
    (raw) => clampLevel(Number(raw)),
    "max level"
  );
}

export function writeConfiguredMaxLevel(level) {
  writeStorage(MAX_LEVEL_STORAGE_KEY, level, String, "max level");
}

export function readSoundEnabled() {
  return readStorage(
    SOUND_ENABLED_STORAGE_KEY,
    true,
    (raw) => raw === "true",
    "sound preference"
  );
}

export function writeSoundEnabled(enabled) {
  writeStorage(SOUND_ENABLED_STORAGE_KEY, Boolean(enabled), String, "sound preference");
}

export function readThemeStats() {
  return readStorage(
    THEME_STATS_STORAGE_KEY,
    {},
    (raw) => {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    },
    "theme stats"
  );
}

export function writeThemeStats(stats) {
  writeStorage(THEME_STATS_STORAGE_KEY, stats, JSON.stringify, "theme stats");
}
