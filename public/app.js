import { Chess } from "chess.js";
import { Chessground } from "@lichess-org/chessground";

const boardElement = document.getElementById("board");
const boardLoader = document.getElementById("board-loader");
const boardLoaderLabel = document.getElementById("board-loader-label");
const boardCaption = document.getElementById("board-caption");
const prevButton = document.getElementById("prev-button");
const hintButton = document.getElementById("hint-button");
const settingsButton = document.getElementById("settings-button");
const settingsDropdown = document.getElementById("settings-dropdown");
const flipToggle = document.getElementById("flip-toggle");
const maxLevelInput = document.getElementById("max-level-input");
const makeLastMoveToggle = document.getElementById("make-last-move-toggle");
const statsButton = document.getElementById("stats-button");
const nextButton = document.getElementById("next-button");
const lichessLink = document.getElementById("lichess-link");
const rangeMinNode = document.getElementById("range-min");
const rangeMaxNode = document.getElementById("range-max");
const levelValueNode = document.getElementById("level-value");
const levelForm = document.getElementById("level-form");
const levelInput = document.getElementById("level-input");
const puzzleRatingNode = document.getElementById("puzzle-rating");
const messageTitleNode = document.getElementById("message-title");
const messageBodyNode = document.getElementById("message-body");
const statsModal = document.getElementById("stats-modal");
const statsCloseButton = document.getElementById("stats-close-button");
const strongThemesNode = document.getElementById("strong-themes");
const weakThemesNode = document.getElementById("weak-themes");

const BASE_URL = new URL(".", window.location.href);
const THEME_STATS_STORAGE_KEY = "puzzlemountain.themeStats.v1";
const MAX_LEVEL_STORAGE_KEY = "puzzlemountain.maxLevel.v1";
const SOLVED_MESSAGE_DELAY_MS = 1400;
const SETUP_MOVE_REPLAY_DELAY_MS = 450;
const ABSOLUTE_MAX_LEVEL = 66;

let metadata = null;
let ground = null;
let chess = null;
let activePuzzle = null;
let activeBand = null;
let currentPuzzleBand = null;
let activeLevel = 0;
let configuredMaxLevel = ABSOLUTE_MAX_LEVEL;
let solutionIndex = 0;
let solvedCurrentPuzzle = false;
let bandCache = new Map();
let shouldRestorePuzzleFromQuery = true;
let currentLastMove = [];
let playerColor = "white";
let isBoardFlipped = false;
let shouldAnimateSetupMove = false;
let isAnimatingSetupMove = false;
let hintedSquare = null;
let puzzleHistory = [];
let solvedFlashTimeout = null;
let setupMoveReplayTimeout = null;
let preloadingBands = new Set();
let firstAttemptState = {
  failed: false,
  recorded: false
};

function assetUrl(relativePath) {
  return new URL(relativePath, BASE_URL).toString();
}

function lichessUrlForColor(url, color) {
  const parsed = new URL(url);
  const basePath = parsed.pathname.replace(/\/black$/, "");
  parsed.pathname = color === "black" ? `${basePath}/black` : basePath;
  return parsed.toString();
}

function updateLichessLink(url, color) {
  if (!url) {
    lichessLink.href = "#";
    lichessLink.classList.add("hidden");
    return;
  }

  lichessLink.href = lichessUrlForColor(url, color);
  lichessLink.classList.remove("hidden");
}

function setMessage(title, body, tone = "neutral") {
  const box = document.getElementById("message-box");
  box.dataset.tone = tone;
  messageTitleNode.textContent = title;
  messageBodyNode.textContent = body;
}

function clearSolvedFlash() {
  const box = document.getElementById("message-box");
  delete box.dataset.flash;
  if (solvedFlashTimeout) {
    window.clearTimeout(solvedFlashTimeout);
    solvedFlashTimeout = null;
  }
}

function setBoardLoadingState(isLoading, label = "Loading puzzle band...") {
  if (!boardLoader || !boardLoaderLabel) {
    return;
  }

  boardLoaderLabel.textContent = label;
  boardLoader.classList.toggle("hidden", !isLoading);
  boardElement.setAttribute("aria-busy", isLoading ? "true" : "false");
}

function flashSolvedMessage() {
  const box = document.getElementById("message-box");
  clearSolvedFlash();
  box.dataset.flash = "solved";
  solvedFlashTimeout = window.setTimeout(() => {
    delete box.dataset.flash;
    solvedFlashTimeout = null;
  }, 850);
}

function toCgColor(color) {
  return color === "w" ? "white" : "black";
}

function levelForBand(band) {
  return clampLevel(Math.floor(band / 50));
}

function rangeMaxForBand(band) {
  return band + 49;
}

function updateLevel(band) {
  const level = levelForBand(band);
  activeLevel = level;
  levelValueNode.textContent = level;
  levelInput.value = level;
}

function clampLevel(level, maxLevel = ABSOLUTE_MAX_LEVEL) {
  const normalizedLevel = Number(level);
  if (!Number.isFinite(normalizedLevel)) {
    return 0;
  }

  return Math.min(Math.max(Math.trunc(normalizedLevel), 0), maxLevel);
}

function effectiveMaxLevel() {
  return clampLevel(configuredMaxLevel);
}

function readConfiguredMaxLevel() {
  try {
    const raw = window.localStorage.getItem(MAX_LEVEL_STORAGE_KEY);
    if (raw === null) {
      return ABSOLUTE_MAX_LEVEL;
    }

    return clampLevel(Number(raw));
  } catch (error) {
    console.warn("[PuzzleMountain] Could not read max level", error);
    return ABSOLUTE_MAX_LEVEL;
  }
}

function writeConfiguredMaxLevel(level) {
  try {
    window.localStorage.setItem(MAX_LEVEL_STORAGE_KEY, String(level));
  } catch (error) {
    console.warn("[PuzzleMountain] Could not persist max level", error);
  }
}

function syncMaxLevelInput() {
  if (!maxLevelInput) {
    return;
  }

  maxLevelInput.value = String(effectiveMaxLevel());
  levelInput.max = String(effectiveMaxLevel());
}

function applyConfiguredMaxLevel(level) {
  configuredMaxLevel = clampLevel(level);
  syncMaxLevelInput();

  if (!metadata) {
    return;
  }

  if (activeLevel > effectiveMaxLevel()) {
    activeBand = normalizedBandForLevel(effectiveMaxLevel());
    updateRangeDisplay(activeBand);
    updateUrl({ level: activeLevel, puzzleId: null });
  }
}

function readThemeStats() {
  try {
    const raw = window.localStorage.getItem(THEME_STATS_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("[PuzzleMountain] Could not read theme stats", error);
    return {};
  }
}

function writeThemeStats(stats) {
  try {
    window.localStorage.setItem(THEME_STATS_STORAGE_KEY, JSON.stringify(stats));
  } catch (error) {
    console.warn("[PuzzleMountain] Could not persist theme stats", error);
  }
}

function formatThemeLabel(theme) {
  return theme
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function recordThemeOutcome(outcome) {
  if (!activePuzzle || firstAttemptState.recorded) {
    return;
  }

  const themes = Array.isArray(activePuzzle.themes) ? activePuzzle.themes : [];
  if (!themes.length) {
    firstAttemptState.recorded = true;
    return;
  }

  const stats = readThemeStats();

  themes.forEach((theme) => {
    const current = stats[theme] && typeof stats[theme] === "object" ? stats[theme] : {};
    const solved = Number.isFinite(current.solved) ? current.solved : 0;
    const failed = Number.isFinite(current.failed) ? current.failed : 0;
    stats[theme] = {
      solved: solved + (outcome === "solved" ? 1 : 0),
      failed: failed + (outcome === "failed" ? 1 : 0)
    };
  });

  writeThemeStats(stats);
  firstAttemptState.recorded = true;
}

function rankedThemes(stats, predicate, sorter) {
  return Object.entries(stats)
    .map(([theme, counts]) => {
      const solved = Number.isFinite(counts?.solved) ? counts.solved : 0;
      const failed = Number.isFinite(counts?.failed) ? counts.failed : 0;
      const total = solved + failed;
      const successRate = total > 0 ? solved / total : 0;

      return {
        theme,
        solved,
        failed,
        total,
        successRate
      };
    })
    .filter((entry) => entry.total > 0)
    .filter(predicate)
    .sort(sorter)
    .slice(0, 8);
}

function renderThemeList(node, items, emptyMessage) {
  if (!items.length) {
    node.innerHTML = `<p class="stats-empty">${emptyMessage}</p>`;
    return;
  }

  node.innerHTML = items
    .map(
      (item) => `
        <article class="stats-item">
          <div class="stats-item-header">
            <p class="stats-item-title">${formatThemeLabel(item.theme)}</p>
            <p class="stats-item-score">${Math.round(item.successRate * 100)}%</p>
          </div>
          <p class="stats-item-meta">Solved first try: ${item.solved} · Mistakes: ${item.failed}</p>
        </article>
      `
    )
    .join("");
}

function renderThemeStats() {
  const stats = readThemeStats();
  const strongThemes = rankedThemes(
    stats,
    (entry) => entry.solved > entry.failed,
    (left, right) =>
      right.successRate - left.successRate ||
      right.solved - left.solved ||
      left.failed - right.failed ||
      left.theme.localeCompare(right.theme)
  );
  const weakThemes = rankedThemes(
    stats,
    (entry) => entry.failed >= entry.solved,
    (left, right) =>
      right.failed - left.failed ||
      left.successRate - right.successRate ||
      right.total - left.total ||
      left.theme.localeCompare(right.theme)
  );

  renderThemeList(strongThemesNode, strongThemes, "No strong themes yet. Solve a few puzzles on the first try.");
  renderThemeList(weakThemesNode, weakThemes, "No weak themes yet. Your mistakes will show up here.");
}

function openStatsModal() {
  renderThemeStats();
  statsModal.showModal();
}

function closeStatsModal() {
  statsModal.close();
}

function updateRangeDisplay(band) {
  activeBand = band;
  rangeMinNode.textContent = band;
  rangeMaxNode.textContent = rangeMaxForBand(band);
  updateLevel(band);
}

function updateUrl({ level = activeLevel, puzzleId = activePuzzle?.id ?? null } = {}) {
  const url = new URL(window.location.href);
  url.searchParams.set("level", String(level));

  if (puzzleId) {
    url.searchParams.set("puzzle", puzzleId);
  } else {
    url.searchParams.delete("puzzle");
  }

  window.history.replaceState({}, "", url);
}

function parsedLevelFromQuery() {
  const raw = new URLSearchParams(window.location.search).get("level");
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? clampLevel(value) : null;
}

function puzzleIdFromQuery() {
  return new URLSearchParams(window.location.search).get("puzzle");
}

function normalizedBandForLevel(level) {
  const clampedLevel = clampLevel(level, effectiveMaxLevel());
  const targetBand = clampedLevel * metadata.bandSize;
  return metadata.availableBands.find((band) => band >= targetBand) ?? metadata.availableBands.at(-1) ?? metadata.lowestBand;
}

function pickRandomPuzzle(puzzles, excludedPuzzleId = null) {
  if (!puzzles.length) {
    return null;
  }

  const candidates = excludedPuzzleId ? puzzles.filter((puzzle) => puzzle.id !== excludedPuzzleId) : puzzles;
  const pool = candidates.length ? candidates : puzzles;
  return pool[Math.floor(Math.random() * pool.length)];
}

function uciToMove(uci) {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci.slice(4, 5) : undefined
  };
}

function uniqueDestinations(moves) {
  return [...new Set(moves.map((move) => move.to))];
}

function computeDests() {
  const dests = new Map();
  const moves = chess.moves({ verbose: true });

  moves.forEach((move) => {
    const existing = dests.get(move.from) || [];
    existing.push(move);
    dests.set(move.from, existing);
  });

  return new Map(
    [...dests.entries()].map(([from, moveList]) => [from, uniqueDestinations(moveList)])
  );
}

function updateHistoryControls() {
  prevButton.disabled = puzzleHistory.length === 0;
}

function updateHintControl() {
  hintButton.disabled = !activePuzzle || solvedCurrentPuzzle || isAnimatingSetupMove;
}

function clearHint() {
  hintedSquare = null;
  updateHintControl();
}

function historyEntryForCurrentPuzzle() {
  if (!activePuzzle || currentPuzzleBand === null) {
    return null;
  }

  return {
    band: currentPuzzleBand,
    puzzle: activePuzzle
  };
}

function boardOrientation() {
  if (!isBoardFlipped) {
    return playerColor;
  }

  return playerColor === "white" ? "black" : "white";
}

function clearSetupMoveReplay() {
  if (!setupMoveReplayTimeout) {
    return;
  }

  window.clearTimeout(setupMoveReplayTimeout);
  setupMoveReplayTimeout = null;
}

function closeSettingsMenu() {
  settingsDropdown.classList.add("hidden");
  settingsButton.setAttribute("aria-expanded", "false");
}

function openSettingsMenu() {
  settingsDropdown.classList.remove("hidden");
  settingsButton.setAttribute("aria-expanded", "true");
}

function syncFlipAccessibilityState() {
  syncMenuCheckboxState(flipToggle);
}

function syncMakeLastMoveAccessibilityState() {
  syncMenuCheckboxState(makeLastMoveToggle);
}

function syncMenuCheckboxState(input) {
  const option = input.closest(".settings-option");
  if (!option) {
    return;
  }

  option.setAttribute("aria-checked", input.checked ? "true" : "false");
}

function syncGround() {
  const canInteract = !isAnimatingSetupMove;
  const config = {
    fen: chess.fen(),
    orientation: boardOrientation(),
    turnColor: toCgColor(chess.turn()),
    coordinates: true,
    coordinatesOnSquares: false,
    movable: {
      color: canInteract ? toCgColor(chess.turn()) : undefined,
      free: false,
      dests: canInteract ? computeDests() : new Map(),
      showDests: true,
      events: {
        after: handleUserMove
      }
    },
    draggable: {
      enabled: canInteract,
      showGhost: true
    },
    selectable: {
      enabled: canInteract
    },
    animation: {
      enabled: true,
      duration: 180
    },
    highlight: {
      lastMove: true,
      check: true
    },
    lastMove: currentLastMove,
    drawable: {
      enabled: true,
      visible: true,
      autoShapes: hintedSquare
        ? [{ orig: hintedSquare, brush: "green" }]
        : []
    }
  };

  if (!ground) {
    boardElement.classList.add("brown");
    ground = Chessground(boardElement, config);
  } else {
    ground.set(config);
  }
}

function resetGroundToCurrentPosition() {
  if (!ground) {
    syncGround();
    return;
  }

  ground.cancelMove();
  syncGround();
  ground.redrawAll();
}

async function loadMetadata() {
  if (metadata) {
    return metadata;
  }

  console.log("[PuzzleMountain] Loading metadata", assetUrl("data/puzzle_bands/metadata.json"));
  const response = await fetch(assetUrl("data/puzzle_bands/metadata.json"));
  if (!response.ok) {
    throw new Error("Could not load puzzle metadata.");
  }

  metadata = await response.json();
  console.log("[PuzzleMountain] Metadata loaded", metadata);
  return metadata;
}

async function loadBand(band) {
  if (bandCache.has(band)) {
    console.log("[PuzzleMountain] Using cached band", band);
    return bandCache.get(band);
  }

  console.log("[PuzzleMountain] Loading band", band, assetUrl(`data/puzzle_bands/${band}.json`));
  const response = await fetch(assetUrl(`data/puzzle_bands/${band}.json`));
  if (!response.ok) {
    throw new Error(`Could not load puzzle band ${band}.`);
  }

  const puzzles = await response.json();
  bandCache.set(band, puzzles);
  console.log("[PuzzleMountain] Band loaded", { band, count: puzzles.length });
  return puzzles;
}

function prefetchBand(band) {
  if (!Number.isFinite(band) || bandCache.has(band) || preloadingBands.has(band)) {
    return;
  }

  preloadingBands.add(band);
  loadBand(band)
    .catch((error) => {
      console.warn("[PuzzleMountain] Band prefetch failed", { band, error });
    })
    .finally(() => {
      preloadingBands.delete(band);
    });
}

function prefetchLikelyNextBand() {
  if (!metadata) {
    return;
  }

  const nextBand = normalizedBandForLevel(Math.min(activeLevel + 1, effectiveMaxLevel()));
  if (nextBand !== activeBand) {
    prefetchBand(nextBand);
  }
}

async function applyPuzzleToBoard(puzzle) {
  clearSetupMoveReplay();
  isAnimatingSetupMove = false;

  const setup = uciToMove(puzzle.setupMove);
  const readyPosition = new Chess(puzzle.fen);
  readyPosition.move(setup);
  playerColor = toCgColor(readyPosition.turn());
  updateLichessLink(puzzle.lichessUrl, playerColor);
  clearHint();

  if (!shouldAnimateSetupMove) {
    chess = readyPosition;
    currentLastMove = [setup.from, setup.to];
    boardCaption.textContent = chess.turn() === "w" ? "White to move." : "Black to move.";
    syncGround();
    return;
  }

  chess = new Chess(puzzle.fen);
  currentLastMove = [];
  isAnimatingSetupMove = true;
  boardCaption.textContent = "Replaying the move that led to this puzzle.";
  updateHintControl();
  syncGround();

  await new Promise((resolve) => {
    setupMoveReplayTimeout = window.setTimeout(() => {
      setupMoveReplayTimeout = null;
      chess.move(setup);
      currentLastMove = [setup.from, setup.to];
      isAnimatingSetupMove = false;
      boardCaption.textContent = chess.turn() === "w" ? "White to move." : "Black to move.";
      updateHintControl();
      syncGround();
      resolve();
    }, SETUP_MOVE_REPLAY_DELAY_MS);
  });
}

async function presentPuzzle(puzzle, band) {
  activeBand = band;
  currentPuzzleBand = band;
  activePuzzle = puzzle;
  solutionIndex = 0;
  solvedCurrentPuzzle = false;
  shouldRestorePuzzleFromQuery = false;
  firstAttemptState = {
    failed: false,
    recorded: false
  };

  updateRangeDisplay(band);
  updateUrl({ level: activeLevel, puzzleId: activePuzzle.id });
  puzzleRatingNode.textContent = `Rating ${activePuzzle.rating}`;
  updateHistoryControls();
  updateHintControl();
  console.log("[PuzzleMountain] Puzzle selected", {
    id: activePuzzle.id,
    rating: activePuzzle.rating,
    band,
    level: activeLevel
  });

  await applyPuzzleToBoard(activePuzzle);
  prefetchLikelyNextBand();
}

async function loadPuzzle({ useQueryPuzzle = false, pushHistory = true } = {}) {
  setMessage("Loading puzzle", "Loading static puzzle data for your current band.");
  nextButton.disabled = true;

  const band = activeBand ?? normalizedBandForLevel(parsedLevelFromQuery() ?? levelForBand(metadata.lowestBand));
  updateRangeDisplay(band);
  console.log("[PuzzleMountain] Loading puzzle", {
    activeBand: band,
    activeLevel,
    useQueryPuzzle,
    requestedPuzzleId: useQueryPuzzle ? puzzleIdFromQuery() : null
  });

  const bandIsCached = bandCache.has(band);
  if (!bandIsCached) {
    setBoardLoadingState(true, "Loading puzzle band...");
  }

  try {
    const puzzles = await loadBand(band);
    const requestedPuzzleId = useQueryPuzzle ? puzzleIdFromQuery() : null;
    const puzzle =
      puzzles.find((candidate) => candidate.id === requestedPuzzleId) ??
      pickRandomPuzzle(puzzles, activePuzzle && activeBand === band ? activePuzzle.id : null);

    if (!puzzle) {
      throw new Error("No puzzles are available for this band.");
    }

    if (pushHistory) {
      const historyEntry = historyEntryForCurrentPuzzle();
      if (historyEntry) {
        puzzleHistory.push(historyEntry);
      }
    }

    if (shouldAnimateSetupMove) {
      setMessage("Watch closely", "Replaying the last move that led to this puzzle.");
    }

    await presentPuzzle(puzzle, band);
    setMessage("Your move", "Find the first move of the solution line.");
  } finally {
    setBoardLoadingState(false);
  }
}

async function handleSolved() {
  const shouldIncreaseLevel = !firstAttemptState.failed && activeLevel < effectiveMaxLevel();

  if (shouldIncreaseLevel) {
    recordThemeOutcome("solved");
  }

  solvedCurrentPuzzle = true;
  updateHintControl();
  setMessage(
    "Correct",
    shouldIncreaseLevel
      ? "You climbed 50 rating points. Loading the next puzzle."
      : firstAttemptState.failed
        ? "Solved, but because you made a mistake on this puzzle, your level stays the same. Loading the next puzzle."
        : "Solved. You are already at your max level, so the next puzzle stays in this range.",
    "success"
  );
  flashSolvedMessage();

  activeBand = normalizedBandForLevel(shouldIncreaseLevel ? activeLevel + 1 : activeLevel);
  updateRangeDisplay(activeBand);
  updateUrl({ level: activeLevel, puzzleId: null });

  window.setTimeout(() => {
    loadPuzzle().catch(handleLoadError);
  }, SOLVED_MESSAGE_DELAY_MS);
}

function handleFailure() {
  const shouldDropLevel = !firstAttemptState.failed;

  if (shouldDropLevel) {
    recordThemeOutcome("failed");
    firstAttemptState.failed = true;

    activeBand = normalizedBandForLevel(Math.max(activeLevel - 1, 0));
    updateRangeDisplay(activeBand);
    updateUrl({ level: activeLevel, puzzleId: null });
  }

  currentLastMove = [];
  clearHint();
  resetGroundToCurrentPosition();
  setMessage(
    "Wrong",
    shouldDropLevel
      ? "That move does not match the solution. You dropped one level."
      : "That move does not match the solution. You already took the level penalty for this puzzle.",
    "danger"
  );
  nextButton.disabled = false;
}

function playExpectedReplyIfNeeded() {
  if (solutionIndex >= activePuzzle.solution.length) {
    handleSolved();
    return;
  }

  const reply = uciToMove(activePuzzle.solution[solutionIndex]);
  chess.move(reply);
  currentLastMove = [reply.from, reply.to];
  solutionIndex += 1;
  syncGround();

  if (solutionIndex >= activePuzzle.solution.length) {
    handleSolved();
  } else {
    setMessage("Keep going", "Good. The reply was played. Find the next move.", "success");
  }
}

function handleUserMove(orig, dest) {
  if (!activePuzzle || solvedCurrentPuzzle || isAnimatingSetupMove) {
    return;
  }

  const expected = activePuzzle.solution[solutionIndex];
  const attempted = `${orig}${dest}${expected.length > 4 ? expected.slice(4, 5) : ""}`;

  if (attempted !== expected) {
    handleFailure();
    return;
  }

  const move = uciToMove(expected);
  const result = chess.move(move);
  if (!result) {
    handleFailure();
    return;
  }

  currentLastMove = [move.from, move.to];
  solutionIndex += 1;
  clearHint();
  syncGround();
  window.setTimeout(playExpectedReplyIfNeeded, 350);
}

function handleLoadError(error) {
  console.error("[PuzzleMountain] Load error", error);
  nextButton.disabled = false;
  setBoardLoadingState(false);
  setMessage("Load failed", error.message, "danger");
}

nextButton.addEventListener("click", () => {
  loadPuzzle().catch(handleLoadError);
});

prevButton.addEventListener("click", () => {
  const previous = puzzleHistory.pop();
  if (!previous) {
    updateHistoryControls();
    return;
  }

  nextButton.disabled = true;
  if (shouldAnimateSetupMove) {
    setMessage("Watch closely", "Replaying the last move that led to this puzzle.");
  }

  presentPuzzle(previous.puzzle, previous.band)
    .then(() => {
      setMessage("Previous puzzle", "You returned to the previous puzzle in your session history.");
    })
    .catch(handleLoadError);
});

hintButton.addEventListener("click", () => {
  if (!activePuzzle || solvedCurrentPuzzle || isAnimatingSetupMove) {
    return;
  }

  const expected = activePuzzle.solution[solutionIndex];
  if (!expected) {
    return;
  }

  hintedSquare = expected.slice(0, 2);
  syncGround();
  setMessage("Hint", `The piece on ${hintedSquare.toUpperCase()} is the one to move.`);
});

flipToggle.addEventListener("change", () => {
  isBoardFlipped = flipToggle.checked;
  syncFlipAccessibilityState();

  if (!chess) {
    return;
  }

  syncGround();
});

makeLastMoveToggle.addEventListener("change", () => {
  shouldAnimateSetupMove = makeLastMoveToggle.checked;
  syncMakeLastMoveAccessibilityState();
});

settingsButton.addEventListener("click", () => {
  if (settingsDropdown.classList.contains("hidden")) {
    openSettingsMenu();
    return;
  }

  closeSettingsMenu();
});

statsButton.addEventListener("click", () => {
  openStatsModal();
});

document.addEventListener("click", (event) => {
  if (!settingsButton || !settingsDropdown) {
    return;
  }

  const target = event.target;
  if (!(target instanceof Node)) {
    return;
  }

  if (settingsButton.contains(target) || settingsDropdown.contains(target)) {
    return;
  }

  closeSettingsMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSettingsMenu();
  }
});

statsCloseButton.addEventListener("click", () => {
  closeStatsModal();
});

statsModal.addEventListener("click", (event) => {
  if (event.target === statsModal) {
    closeStatsModal();
  }
});

statsModal.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeStatsModal();
});

levelForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const requestedLevel = Number(levelInput.value);
  if (!Number.isInteger(requestedLevel) || requestedLevel < 0 || requestedLevel > effectiveMaxLevel()) {
    setMessage("Invalid level", `Level must be a whole number from 0 to ${effectiveMaxLevel()}.`, "danger");
    return;
  }

  activeBand = normalizedBandForLevel(requestedLevel);
  updateRangeDisplay(activeBand);
  updateUrl({ level: activeLevel, puzzleId: null });
  loadPuzzle().catch(handleLoadError);
});

maxLevelInput.addEventListener("change", () => {
  const requestedMaxLevel = Number(maxLevelInput.value);
  if (!Number.isInteger(requestedMaxLevel) || requestedMaxLevel < 0 || requestedMaxLevel > ABSOLUTE_MAX_LEVEL) {
    syncMaxLevelInput();
    setMessage("Invalid max level", `Max level must be a whole number from 0 to ${ABSOLUTE_MAX_LEVEL}.`, "danger");
    return;
  }

  writeConfiguredMaxLevel(requestedMaxLevel);
  applyConfiguredMaxLevel(requestedMaxLevel);
  loadPuzzle({ pushHistory: false }).catch(handleLoadError);
});

async function init() {
  try {
    configuredMaxLevel = readConfiguredMaxLevel();
    syncMaxLevelInput();
    await loadMetadata();

    const requestedLevel = parsedLevelFromQuery();
    applyConfiguredMaxLevel(configuredMaxLevel);
    activeBand = normalizedBandForLevel(requestedLevel ?? levelForBand(metadata.lowestBand));
    updateRangeDisplay(activeBand);

    await loadPuzzle({ useQueryPuzzle: shouldRestorePuzzleFromQuery });
  } catch (error) {
    handleLoadError(error);
  }
}

updateHistoryControls();
updateHintControl();
syncFlipAccessibilityState();
syncMakeLastMoveAccessibilityState();
setBoardLoadingState(true, "Preparing board...");
init();
