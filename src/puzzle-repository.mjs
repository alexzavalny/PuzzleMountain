import { assetUrl } from "./asset-url.mjs";

function toInteger(value, fallback = 0) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeMetadata(metadata) {
  const availableBands = Array.isArray(metadata?.availableBands)
    ? metadata.availableBands
        .map((band) => toInteger(band, Number.NaN))
        .filter((band) => Number.isFinite(band))
        .sort((left, right) => left - right)
    : [];

  return {
    ...metadata,
    bandSize: Math.max(toInteger(metadata?.bandSize, 50), 1),
    lowestBand: availableBands[0] ?? toInteger(metadata?.lowestBand, 0),
    availableBands,
    bandCounts:
      metadata?.bandCounts && typeof metadata.bandCounts === "object"
        ? Object.fromEntries(
            Object.entries(metadata.bandCounts).map(([band, count]) => [
              String(toInteger(band)),
              toInteger(count)
            ])
          )
        : {}
  };
}

export class PuzzleRepository {
  constructor({ fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
    this.fetchImpl = fetchImpl;
    this.metadata = null;
    this.bandCache = new Map();
    this.preloadingBands = new Set();
  }

  hasBand(band) {
    return this.bandCache.has(band);
  }

  async loadMetadata() {
    if (this.metadata) {
      return this.metadata;
    }

    const url = assetUrl("data/puzzle_bands/metadata.json");
    console.log("[PuzzleMountain] Loading metadata", url);
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error("Could not load puzzle metadata.");
    }

    this.metadata = normalizeMetadata(await response.json());
    console.log("[PuzzleMountain] Metadata loaded", this.metadata);
    return this.metadata;
  }

  async loadBand(band) {
    if (this.bandCache.has(band)) {
      console.log("[PuzzleMountain] Using cached band", band);
      return this.bandCache.get(band);
    }

    const url = assetUrl(`data/puzzle_bands/${band}.json`);
    console.log("[PuzzleMountain] Loading band", band, url);
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Could not load puzzle band ${band}.`);
    }

    const puzzles = await response.json();
    this.bandCache.set(band, puzzles);
    console.log("[PuzzleMountain] Band loaded", { band, count: puzzles.length });
    return puzzles;
  }

  prefetchBand(band) {
    if (!Number.isFinite(band) || this.bandCache.has(band) || this.preloadingBands.has(band)) {
      return;
    }

    this.preloadingBands.add(band);
    this.loadBand(band)
      .catch((error) => {
        console.warn("[PuzzleMountain] Band prefetch failed", { band, error });
      })
      .finally(() => {
        this.preloadingBands.delete(band);
      });
  }
}
