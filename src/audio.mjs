import { assetUrl } from "./asset-url.mjs";
import { SOUND_ASSETS, SOUND_VOLUME } from "./constants.mjs";

export class AudioController {
  constructor() {
    this.enabled = true;
    this.soundUrlCache = new Map();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  soundUrl(name) {
    if (!this.soundUrlCache.has(name)) {
      this.soundUrlCache.set(name, assetUrl(SOUND_ASSETS[name]));
    }

    return this.soundUrlCache.get(name);
  }

  prime() {
    Object.keys(SOUND_ASSETS).forEach((name) => {
      const audio = new Audio(this.soundUrl(name));
      audio.preload = "auto";
      audio.volume = SOUND_VOLUME;
      audio.load();
    });
  }

  play(name, { reason = "runtime", verbose = false, ignoreSoundEnabled = false } = {}) {
    if (!SOUND_ASSETS[name]) {
      if (verbose) {
        console.log("[PuzzleMountain][SoundDebug]", {
          event: "missing-asset",
          name,
          reason
        });
      }
      return null;
    }

    if (!this.enabled && !ignoreSoundEnabled) {
      if (verbose) {
        console.log("[PuzzleMountain][SoundDebug]", {
          event: "blocked-sound-disabled",
          name,
          reason,
          soundEnabled: this.enabled
        });
      }
      return null;
    }

    const url = this.soundUrl(name);
    const audio = new Audio(url);
    audio.preload = "auto";
    audio.volume = SOUND_VOLUME;

    if (verbose) {
      const startedAt = performance.now();
      const log = (event, extra = {}) => {
        console.log("[PuzzleMountain][SoundDebug]", {
          name,
          reason,
          event,
          url,
          currentSrc: audio.currentSrc,
          readyState: audio.readyState,
          networkState: audio.networkState,
          currentTime: audio.currentTime,
          duration: Number.isFinite(audio.duration) ? audio.duration : null,
          paused: audio.paused,
          muted: audio.muted,
          volume: audio.volume,
          error:
            audio.error
              ? {
                  code: audio.error.code,
                  message: audio.error.message ?? null
                }
              : null,
          elapsedMs: Math.round(performance.now() - startedAt),
          ...extra
        });
      };

      [
        "loadstart",
        "loadedmetadata",
        "loadeddata",
        "canplay",
        "canplaythrough",
        "play",
        "playing",
        "pause",
        "ended",
        "error",
        "stalled",
        "suspend",
        "abort"
      ].forEach((eventName) => {
        audio.addEventListener(eventName, () => log(eventName));
      });

      log("created", { soundEnabled: this.enabled });
    }

    const playback = audio.play();
    if (playback && typeof playback.catch === "function") {
      playback
        .then(() => {
          if (verbose) {
            console.log("[PuzzleMountain][SoundDebug]", {
              name,
              reason,
              event: "play-promise-resolved",
              url
            });
          }
        })
        .catch((error) => {
          console.log("[PuzzleMountain][SoundDebug]", {
            name,
            reason,
            event: "play-promise-rejected",
            url,
            message: error?.message ?? String(error)
          });
        });
    }

    return audio;
  }

  playWithDebug(name, options = {}) {
    return this.play(name, {
      reason: "manual-debug",
      verbose: true,
      ignoreSoundEnabled: true,
      ...options
    });
  }

  renderDebugListMarkup() {
    return Object.entries(SOUND_ASSETS)
      .map(
        ([name, relativePath]) => `
          <article class="sound-debug-row">
            <div>
              <p class="sound-debug-row-title">${name}</p>
              <p class="sound-debug-row-meta">${assetUrl(relativePath)}</p>
            </div>
            <button class="secondary" type="button" data-sound-debug-play="${name}">Play</button>
          </article>
        `
      )
      .join("");
  }
}

export function playMoveSound(audioController, move) {
  if (move.captured) {
    audioController.play("capture");
    return;
  }

  audioController.play("move");
}
