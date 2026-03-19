import { Chess } from "chess.js";
import { Chessground } from "@lichess-org/chessground";

const boardElement = document.getElementById("board");
const boardCaption = document.getElementById("board-caption");
const prevButton = document.getElementById("prev-button");
const hintButton = document.getElementById("hint-button");
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

let metadata = null;
let ground = null;
let chess = null;
let activePuzzle = null;
let activeBand = null;
let currentPuzzleBand = null;
let activeLevel = 0;
let solutionIndex = 0;
let solvedCurrentPuzzle = false;
let bandCache = new Map();
let shouldRestorePuzzleFromQuery = true;
let currentLastMove = [];
let playerColor = "white";
let hintedSquare = null;
let puzzleHistory = [];
let solvedFlashTimeout = null;
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
  return Math.floor(band / 50);
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
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function puzzleIdFromQuery() {
  return new URLSearchParams(window.location.search).get("puzzle");
}

function normalizedBandForLevel(level) {
  const targetBand = level * metadata.bandSize;
  return metadata.availableBands.find((band) => band >= targetBand) ?? metadata.lowestBand;
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
  hintButton.disabled = !activePuzzle || solvedCurrentPuzzle;
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

function syncGround() {
  const config = {
    fen: chess.fen(),
    orientation: playerColor,
    turnColor: toCgColor(chess.turn()),
    coordinates: true,
    coordinatesOnSquares: false,
    movable: {
      color: toCgColor(chess.turn()),
      free: false,
      dests: computeDests(),
      showDests: true,
      events: {
        after: handleUserMove
      }
    },
    draggable: {
      enabled: true,
      showGhost: true
    },
    selectable: {
      enabled: true
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

function applyPuzzleToBoard(puzzle) {
  chess = new Chess(puzzle.fen);
  const setup = uciToMove(puzzle.setupMove);
  chess.move(setup);
  currentLastMove = [setup.from, setup.to];
  playerColor = toCgColor(chess.turn());
  updateLichessLink(puzzle.lichessUrl, playerColor);
  boardCaption.textContent = chess.turn() === "w" ? "White to move." : "Black to move.";
  clearHint();
  syncGround();
}

function presentPuzzle(puzzle, band) {
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

  applyPuzzleToBoard(activePuzzle);
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

  presentPuzzle(puzzle, band);
  setMessage("Your move", "Find the first move of the solution line.");
}

async function handleSolved() {
  if (!firstAttemptState.failed) {
    recordThemeOutcome("solved");
  }

  solvedCurrentPuzzle = true;
  updateHintControl();
  setMessage("Correct", "You climbed 50 rating points. Loading the next puzzle.", "success");
  flashSolvedMessage();

  activeBand = normalizedBandForLevel(activeLevel + 1);
  updateRangeDisplay(activeBand);
  updateUrl({ level: activeLevel, puzzleId: null });

  window.setTimeout(() => {
    loadPuzzle().catch(handleLoadError);
  }, 900);
}

function handleFailure() {
  if (!firstAttemptState.failed) {
    recordThemeOutcome("failed");
    firstAttemptState.failed = true;
  }

  activeBand = normalizedBandForLevel(Math.max(activeLevel - 1, 0));
  updateRangeDisplay(activeBand);
  updateUrl({ level: activeLevel, puzzleId: null });
  currentLastMove = [];
  clearHint();
  resetGroundToCurrentPosition();
  setMessage("Wrong", "That move does not match the solution. You dropped one level.", "danger");
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
  if (!activePuzzle || solvedCurrentPuzzle) {
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
  presentPuzzle(previous.puzzle, previous.band);
  setMessage("Previous puzzle", "You returned to the previous puzzle in your session history.");
});

hintButton.addEventListener("click", () => {
  if (!activePuzzle || solvedCurrentPuzzle) {
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

statsButton.addEventListener("click", () => {
  openStatsModal();
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
  if (!Number.isInteger(requestedLevel) || requestedLevel < 0) {
    setMessage("Invalid level", "Level must be a whole number 0 or greater.", "danger");
    return;
  }

  activeBand = normalizedBandForLevel(requestedLevel);
  updateRangeDisplay(activeBand);
  updateUrl({ level: activeLevel, puzzleId: null });
  loadPuzzle().catch(handleLoadError);
});

async function init() {
  try {
    await loadMetadata();

    const requestedLevel = parsedLevelFromQuery();
    activeBand = normalizedBandForLevel(requestedLevel ?? levelForBand(metadata.lowestBand));
    updateRangeDisplay(activeBand);

    await loadPuzzle({ useQueryPuzzle: shouldRestorePuzzleFromQuery });
  } catch (error) {
    handleLoadError(error);
  }
}

updateHistoryControls();
updateHintControl();
init();
