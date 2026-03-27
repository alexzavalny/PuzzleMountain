import { Chess } from "chess.js";
import { Chessground } from "@lichess-org/chessground";
import { AudioController, playMoveSound } from "./audio.mjs";
import {
  ABSOLUTE_MAX_LEVEL,
  SETUP_MOVE_REPLAY_DELAY_MS,
  SOLVED_MESSAGE_DELAY_MS
} from "./constants.mjs";
import { elements } from "./dom.mjs";
import { toCgColor, uciToMove, computeDests } from "./lib/chess-utils.mjs";
import { clampLevel, levelForBand, normalizedBandForLevel, rangeMaxForBand } from "./lib/level-utils.mjs";
import {
  readConfiguredMaxLevel,
  readSoundEnabled,
  readStopwatchVisible,
  readThemeStats,
  writeConfiguredMaxLevel,
  writeSoundEnabled,
  writeStopwatchVisible,
  writeThemeStats
} from "./preferences.mjs";
import { PuzzleRepository } from "./puzzle-repository.mjs";
import { formatThemeLabel, recordThemeOutcome, summarizeThemeStats } from "./theme-stats.mjs";

const repository = new PuzzleRepository();
const audio = new AudioController();

const state = {
  ground: null,
  chess: null,
  activePuzzle: null,
  activeBand: null,
  currentPuzzleBand: null,
  activeLevel: 0,
  configuredMaxLevel: ABSOLUTE_MAX_LEVEL,
  solutionIndex: 0,
  solvedCurrentPuzzle: false,
  shouldRestorePuzzleFromQuery: true,
  currentLastMove: [],
  playerColor: "white",
  isBoardFlipped: false,
  isStopwatchVisible: true,
  shouldAnimateSetupMove: false,
  isAnimatingSetupMove: false,
  hintedSquare: null,
  puzzleHistory: [],
  solvedFlashTimeout: null,
  setupMoveReplayTimeout: null,
  stopwatchInterval: null,
  stopwatchStartedAt: null,
  stopwatchElapsedMs: 0,
  firstAttemptState: {
    failed: false,
    recorded: false
  }
};

function currentMetadata() {
  if (!repository.metadata) {
    throw new Error("Puzzle metadata has not been loaded.");
  }

  return repository.metadata;
}

function effectiveMaxLevel() {
  return clampLevel(state.configuredMaxLevel);
}

function resolvedBandForLevel(level) {
  return normalizedBandForLevel({
    level,
    metadata: currentMetadata(),
    maxLevel: effectiveMaxLevel()
  });
}

function boardTurnCaption(chess) {
  return chess.turn() === "w" ? "White to move." : "Black to move.";
}

function lichessUrlForColor(url, color) {
  const parsed = new URL(url);
  const basePath = parsed.pathname.replace(/\/black$/, "");
  parsed.pathname = color === "black" ? `${basePath}/black` : basePath;
  return parsed.toString();
}

function updateLichessLink(url, color) {
  if (!url) {
    elements.lichessLink.href = "#";
    elements.lichessLink.classList.add("hidden");
    return;
  }

  elements.lichessLink.href = lichessUrlForColor(url, color);
  elements.lichessLink.classList.remove("hidden");
}

function setMessage(title, body, tone = "neutral") {
  elements.messageBox.dataset.tone = tone;
  elements.messageTitleNode.textContent = title;
  elements.messageBodyNode.textContent = body;
}

function clearSolvedFlash() {
  delete elements.messageBox.dataset.flash;
  if (state.solvedFlashTimeout) {
    window.clearTimeout(state.solvedFlashTimeout);
    state.solvedFlashTimeout = null;
  }
}

function setBoardLoadingState(isLoading, label = "Loading puzzle band...") {
  elements.boardLoaderLabel.textContent = label;
  elements.boardLoader.classList.toggle("hidden", !isLoading);
  elements.board.setAttribute("aria-busy", isLoading ? "true" : "false");
}

function flashSolvedMessage() {
  clearSolvedFlash();
  elements.messageBox.dataset.flash = "solved";
  state.solvedFlashTimeout = window.setTimeout(() => {
    delete elements.messageBox.dataset.flash;
    state.solvedFlashTimeout = null;
  }, 850);
}

function updateLevel(band) {
  const level = levelForBand(band);
  state.activeLevel = level;
  elements.levelValueNode.textContent = String(level);
  elements.levelInput.value = String(level);
}

function syncMaxLevelInput() {
  const maxLevel = String(effectiveMaxLevel());
  elements.maxLevelInput.value = maxLevel;
  elements.levelInput.max = maxLevel;
}

function applyConfiguredMaxLevel(level) {
  state.configuredMaxLevel = clampLevel(level);
  syncMaxLevelInput();

  if (!repository.metadata) {
    return;
  }

  if (state.activeLevel > effectiveMaxLevel()) {
    state.activeBand = resolvedBandForLevel(effectiveMaxLevel());
    updateRangeDisplay(state.activeBand);
    updateUrl({ level: state.activeLevel, puzzleId: null });
  }
}

function recordThemeOutcomeForActivePuzzle(outcome) {
  if (!state.activePuzzle || state.firstAttemptState.recorded) {
    return;
  }

  const themes = Array.isArray(state.activePuzzle.themes) ? state.activePuzzle.themes : [];
  if (!themes.length) {
    state.firstAttemptState.recorded = true;
    return;
  }

  writeThemeStats(recordThemeOutcome(readThemeStats(), themes, outcome));
  state.firstAttemptState.recorded = true;
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
  const { strongThemes, weakThemes } = summarizeThemeStats(readThemeStats());

  renderThemeList(
    elements.strongThemesNode,
    strongThemes,
    "No strong themes yet. Solve a few puzzles on the first try."
  );
  renderThemeList(
    elements.weakThemesNode,
    weakThemes,
    "No weak themes yet. Your mistakes will show up here."
  );
}

function openStatsModal() {
  renderThemeStats();
  elements.statsModal.showModal();
}

function closeStatsModal() {
  elements.statsModal.close();
}

function renderSoundDebugList() {
  elements.soundDebugList.innerHTML = audio.renderDebugListMarkup();
}

function openSoundDebugModal() {
  renderSoundDebugList();
  elements.soundDebugModal.showModal();
}

function closeSoundDebugModal() {
  elements.soundDebugModal.close();
}

function updateRangeDisplay(band) {
  state.activeBand = band;
  elements.rangeMinNode.textContent = String(band);
  elements.rangeMaxNode.textContent = String(rangeMaxForBand(band));
  updateLevel(band);
}

function updateUrl({ level = state.activeLevel, puzzleId = state.activePuzzle?.id ?? null } = {}) {
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

function pickRandomPuzzle(puzzles, excludedPuzzleId = null) {
  if (!puzzles.length) {
    return null;
  }

  const candidates = excludedPuzzleId ? puzzles.filter((puzzle) => puzzle.id !== excludedPuzzleId) : puzzles;
  const pool = candidates.length ? candidates : puzzles;
  return pool[Math.floor(Math.random() * pool.length)];
}

function updateHistoryControls() {
  elements.prevButton.disabled = state.puzzleHistory.length === 0;
}

function updateHintControl() {
  elements.hintButton.disabled = !state.activePuzzle || state.solvedCurrentPuzzle || state.isAnimatingSetupMove;
}

function clearHint() {
  state.hintedSquare = null;
  updateHintControl();
}

function historyEntryForCurrentPuzzle() {
  if (!state.activePuzzle || state.currentPuzzleBand === null) {
    return null;
  }

  return {
    band: state.currentPuzzleBand,
    puzzle: state.activePuzzle
  };
}

function boardOrientation() {
  if (!state.isBoardFlipped) {
    return state.playerColor;
  }

  return state.playerColor === "white" ? "black" : "white";
}

function clearSetupMoveReplay() {
  if (!state.setupMoveReplayTimeout) {
    return;
  }

  window.clearTimeout(state.setupMoveReplayTimeout);
  state.setupMoveReplayTimeout = null;
}

function closeSettingsMenu() {
  elements.settingsDropdown.classList.add("hidden");
  elements.settingsButton.setAttribute("aria-expanded", "false");
}

function openSettingsMenu() {
  elements.settingsDropdown.classList.remove("hidden");
  elements.settingsButton.setAttribute("aria-expanded", "true");
}

function syncMenuCheckboxState(input) {
  const option = input.closest(".settings-option");
  if (!option) {
    return;
  }

  option.setAttribute("aria-checked", input.checked ? "true" : "false");
}

function syncFlipAccessibilityState() {
  syncMenuCheckboxState(elements.flipToggle);
}

function syncSoundAccessibilityState() {
  syncMenuCheckboxState(elements.soundToggle);
}

function syncStopwatchAccessibilityState() {
  syncMenuCheckboxState(elements.stopwatchToggle);
}

function syncMakeLastMoveAccessibilityState() {
  syncMenuCheckboxState(elements.makeLastMoveToggle);
}

function applySoundEnabled(enabled) {
  audio.setEnabled(enabled);
  elements.soundToggle.checked = audio.enabled;
  syncSoundAccessibilityState();
}

function formatStopwatch(elapsedMs) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderStopwatch() {
  elements.stopwatchPanel.classList.toggle("hidden", !state.isStopwatchVisible);
  elements.stopwatchValue.textContent = formatStopwatch(state.stopwatchElapsedMs);
}

function stopStopwatch() {
  if (!state.stopwatchInterval) {
    return;
  }

  window.clearInterval(state.stopwatchInterval);
  state.stopwatchInterval = null;
}

function startStopwatch() {
  stopStopwatch();
  state.stopwatchStartedAt = Date.now();
  state.stopwatchElapsedMs = 0;
  renderStopwatch();
  state.stopwatchInterval = window.setInterval(() => {
    if (state.stopwatchStartedAt === null) {
      return;
    }

    state.stopwatchElapsedMs = Date.now() - state.stopwatchStartedAt;
    renderStopwatch();
  }, 1000);
}

function applyStopwatchVisible(visible) {
  state.isStopwatchVisible = visible;
  elements.stopwatchToggle.checked = visible;
  syncStopwatchAccessibilityState();
  renderStopwatch();
}

function syncGround() {
  if (!state.chess) {
    return;
  }

  const canInteract = !state.isAnimatingSetupMove;
  const config = {
    fen: state.chess.fen(),
    orientation: boardOrientation(),
    turnColor: toCgColor(state.chess.turn()),
    coordinates: true,
    coordinatesOnSquares: false,
    movable: {
      color: canInteract ? toCgColor(state.chess.turn()) : undefined,
      free: false,
      dests: canInteract ? computeDests(state.chess) : new Map(),
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
    lastMove: state.currentLastMove,
    drawable: {
      enabled: true,
      visible: true,
      autoShapes: state.hintedSquare ? [{ orig: state.hintedSquare, brush: "green" }] : []
    }
  };

  if (!state.ground) {
    elements.board.classList.add("brown");
    state.ground = Chessground(elements.board, config);
  } else {
    state.ground.set(config);
  }
}

function resetGroundToCurrentPosition() {
  if (!state.ground) {
    syncGround();
    return;
  }

  state.ground.cancelMove();
  syncGround();
  state.ground.redrawAll();
}

async function loadMetadata() {
  return repository.loadMetadata();
}

function prefetchLikelyNextBand() {
  if (!repository.metadata) {
    return;
  }

  const nextBand = resolvedBandForLevel(Math.min(state.activeLevel + 1, effectiveMaxLevel()));
  if (nextBand !== state.activeBand) {
    repository.prefetchBand(nextBand);
  }
}

async function applyPuzzleToBoard(puzzle) {
  clearSetupMoveReplay();
  state.isAnimatingSetupMove = false;

  const setup = uciToMove(puzzle.setupMove);
  const readyPosition = new Chess(puzzle.fen);
  readyPosition.move(setup);
  state.playerColor = toCgColor(readyPosition.turn());
  updateLichessLink(puzzle.lichessUrl, state.playerColor);
  clearHint();

  if (!state.shouldAnimateSetupMove) {
    state.chess = readyPosition;
    state.currentLastMove = [setup.from, setup.to];
    elements.boardCaption.textContent = boardTurnCaption(state.chess);
    syncGround();
    return;
  }

  state.chess = new Chess(puzzle.fen);
  state.currentLastMove = [];
  state.isAnimatingSetupMove = true;
  elements.boardCaption.textContent = "Replaying the move that led to this puzzle.";
  updateHintControl();
  syncGround();

  await new Promise((resolve) => {
    state.setupMoveReplayTimeout = window.setTimeout(() => {
      state.setupMoveReplayTimeout = null;
      state.chess.move(setup);
      state.currentLastMove = [setup.from, setup.to];
      state.isAnimatingSetupMove = false;
      elements.boardCaption.textContent = boardTurnCaption(state.chess);
      updateHintControl();
      syncGround();
      resolve();
    }, SETUP_MOVE_REPLAY_DELAY_MS);
  });
}

async function presentPuzzle(puzzle, band) {
  state.activeBand = band;
  state.currentPuzzleBand = band;
  state.activePuzzle = puzzle;
  startStopwatch();
  state.solutionIndex = 0;
  state.solvedCurrentPuzzle = false;
  state.shouldRestorePuzzleFromQuery = false;
  state.firstAttemptState = {
    failed: false,
    recorded: false
  };

  updateRangeDisplay(band);
  updateUrl({ level: state.activeLevel, puzzleId: state.activePuzzle.id });
  elements.puzzleRatingNode.textContent = `Rating ${state.activePuzzle.rating}`;
  updateHistoryControls();
  updateHintControl();
  console.log("[PuzzleMountain] Puzzle selected", {
    id: state.activePuzzle.id,
    rating: state.activePuzzle.rating,
    band,
    level: state.activeLevel
  });

  await applyPuzzleToBoard(state.activePuzzle);
  prefetchLikelyNextBand();
}

async function loadPuzzle({ useQueryPuzzle = false, pushHistory = true } = {}) {
  setMessage("Loading puzzle", "Loading static puzzle data for your current band.");
  elements.nextButton.disabled = true;

  const band =
    state.activeBand ??
    resolvedBandForLevel(parsedLevelFromQuery() ?? levelForBand(currentMetadata().lowestBand));

  updateRangeDisplay(band);
  console.log("[PuzzleMountain] Loading puzzle", {
    activeBand: band,
    activeLevel: state.activeLevel,
    useQueryPuzzle,
    requestedPuzzleId: useQueryPuzzle ? puzzleIdFromQuery() : null
  });

  if (!repository.hasBand(band)) {
    setBoardLoadingState(true, "Loading puzzle band...");
  }

  try {
    const puzzles = await repository.loadBand(band);
    const requestedPuzzleId = useQueryPuzzle ? puzzleIdFromQuery() : null;
    const puzzle =
      puzzles.find((candidate) => candidate.id === requestedPuzzleId) ??
      pickRandomPuzzle(puzzles, state.activePuzzle && state.activeBand === band ? state.activePuzzle.id : null);

    if (!puzzle) {
      throw new Error("No puzzles are available for this band.");
    }

    if (pushHistory) {
      const historyEntry = historyEntryForCurrentPuzzle();
      if (historyEntry) {
        state.puzzleHistory.push(historyEntry);
      }
    }

    if (state.shouldAnimateSetupMove) {
      setMessage("Watch closely", "Replaying the last move that led to this puzzle.");
    }

    await presentPuzzle(puzzle, band);
    setMessage("Your move", "Find the first move of the solution line.");
  } finally {
    setBoardLoadingState(false);
  }
}

async function handleSolved() {
  const shouldIncreaseLevel = !state.firstAttemptState.failed && state.activeLevel < effectiveMaxLevel();

  if (shouldIncreaseLevel) {
    recordThemeOutcomeForActivePuzzle("solved");
  }

  state.solvedCurrentPuzzle = true;
  updateHintControl();
  setMessage(
    "Correct",
    shouldIncreaseLevel
      ? "You climbed 50 rating points. Loading the next puzzle."
      : state.firstAttemptState.failed
        ? "Solved, but because you made a mistake on this puzzle, your level stays the same. Loading the next puzzle."
        : "Solved. You are already at your max level, so the next puzzle stays in this range.",
    "success"
  );
  flashSolvedMessage();

  state.activeBand = resolvedBandForLevel(shouldIncreaseLevel ? state.activeLevel + 1 : state.activeLevel);
  updateRangeDisplay(state.activeBand);
  updateUrl({ level: state.activeLevel, puzzleId: null });

  window.setTimeout(() => {
    loadPuzzle().catch(handleLoadError);
  }, SOLVED_MESSAGE_DELAY_MS);
}

function handleFailure() {
  const shouldDropLevel = !state.firstAttemptState.failed;

  if (shouldDropLevel) {
    recordThemeOutcomeForActivePuzzle("failed");
    state.firstAttemptState.failed = true;

    state.activeBand = resolvedBandForLevel(Math.max(state.activeLevel - 1, 0));
    updateRangeDisplay(state.activeBand);
    updateUrl({ level: state.activeLevel, puzzleId: null });
  }

  state.currentLastMove = [];
  clearHint();
  resetGroundToCurrentPosition();
  setMessage(
    "Wrong",
    shouldDropLevel
      ? "That move does not match the solution. You dropped one level."
      : "That move does not match the solution. You already took the level penalty for this puzzle.",
    "danger"
  );
  elements.nextButton.disabled = false;
}

function playExpectedReplyIfNeeded() {
  if (!state.activePuzzle) {
    return;
  }

  if (state.solutionIndex >= state.activePuzzle.solution.length) {
    handleSolved().catch(handleLoadError);
    return;
  }

  const reply = uciToMove(state.activePuzzle.solution[state.solutionIndex]);
  const result = state.chess.move(reply);
  if (!result) {
    handleLoadError(new Error("Could not play the puzzle reply."));
    return;
  }

  state.currentLastMove = [reply.from, reply.to];
  state.solutionIndex += 1;
  syncGround();
  playMoveSound(audio, result);

  if (state.solutionIndex >= state.activePuzzle.solution.length) {
    handleSolved().catch(handleLoadError);
  } else {
    setMessage("Keep going", "Good. The reply was played. Find the next move.", "success");
  }
}

function handleUserMove(orig, dest) {
  if (!state.activePuzzle || state.solvedCurrentPuzzle || state.isAnimatingSetupMove) {
    return;
  }

  const expected = state.activePuzzle.solution[state.solutionIndex];
  const attempted = `${orig}${dest}${expected.length > 4 ? expected.slice(4, 5) : ""}`;

  if (attempted !== expected) {
    handleFailure();
    return;
  }

  const move = uciToMove(expected);
  const result = state.chess.move(move);
  if (!result) {
    handleFailure();
    return;
  }

  state.currentLastMove = [move.from, move.to];
  state.solutionIndex += 1;
  clearHint();
  syncGround();
  playMoveSound(audio, result);
  window.setTimeout(playExpectedReplyIfNeeded, 350);
}

function handleLoadError(error) {
  console.error("[PuzzleMountain] Load error", error);
  elements.nextButton.disabled = false;
  setBoardLoadingState(false);
  setMessage("Load failed", error instanceof Error ? error.message : String(error), "danger");
}

function bindEventListeners() {
  elements.nextButton.addEventListener("click", () => {
    loadPuzzle().catch(handleLoadError);
  });

  elements.prevButton.addEventListener("click", () => {
    const previous = state.puzzleHistory.pop();
    if (!previous) {
      updateHistoryControls();
      return;
    }

    elements.nextButton.disabled = true;
    if (state.shouldAnimateSetupMove) {
      setMessage("Watch closely", "Replaying the last move that led to this puzzle.");
    }

    presentPuzzle(previous.puzzle, previous.band)
      .then(() => {
        setMessage("Previous puzzle", "You returned to the previous puzzle in your session history.");
      })
      .catch(handleLoadError);
  });

  elements.hintButton.addEventListener("click", () => {
    if (!state.activePuzzle || state.solvedCurrentPuzzle || state.isAnimatingSetupMove) {
      return;
    }

    const expected = state.activePuzzle.solution[state.solutionIndex];
    if (!expected) {
      return;
    }

    state.hintedSquare = expected.slice(0, 2);
    syncGround();
    setMessage("Hint", `The piece on ${state.hintedSquare.toUpperCase()} is the one to move.`);
  });

  elements.flipToggle.addEventListener("change", () => {
    state.isBoardFlipped = elements.flipToggle.checked;
    syncFlipAccessibilityState();

    if (!state.chess) {
      return;
    }

    syncGround();
  });

  elements.soundToggle.addEventListener("change", () => {
    applySoundEnabled(elements.soundToggle.checked);
    writeSoundEnabled(audio.enabled);
  });

  elements.stopwatchToggle.addEventListener("change", () => {
    applyStopwatchVisible(elements.stopwatchToggle.checked);
    writeStopwatchVisible(state.isStopwatchVisible);
  });

  elements.makeLastMoveToggle.addEventListener("change", () => {
    state.shouldAnimateSetupMove = elements.makeLastMoveToggle.checked;
    syncMakeLastMoveAccessibilityState();
  });

  elements.settingsButton.addEventListener("click", () => {
    if (elements.settingsDropdown.classList.contains("hidden")) {
      openSettingsMenu();
      return;
    }

    closeSettingsMenu();
  });

  elements.statsButton.addEventListener("click", openStatsModal);
  elements.soundDebugButton.addEventListener("click", () => {
    closeSettingsMenu();
    openSoundDebugModal();
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    if (elements.settingsButton.contains(target) || elements.settingsDropdown.contains(target)) {
      return;
    }

    closeSettingsMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSettingsMenu();
    }
  });

  elements.statsCloseButton.addEventListener("click", closeStatsModal);

  elements.statsModal.addEventListener("click", (event) => {
    if (event.target === elements.statsModal) {
      closeStatsModal();
    }
  });

  elements.statsModal.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeStatsModal();
  });

  elements.soundDebugCloseButton.addEventListener("click", closeSoundDebugModal);

  elements.soundDebugModal.addEventListener("click", (event) => {
    if (event.target === elements.soundDebugModal) {
      closeSoundDebugModal();
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const soundName = target.dataset.soundDebugPlay;
    if (!soundName) {
      return;
    }

    audio.playWithDebug(soundName, { reason: "manual-debug", verbose: true });
  });

  elements.soundDebugModal.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeSoundDebugModal();
  });

  elements.levelForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const requestedLevel = Number(elements.levelInput.value);
    if (
      !Number.isInteger(requestedLevel) ||
      requestedLevel < 0 ||
      requestedLevel > effectiveMaxLevel()
    ) {
      setMessage(
        "Invalid level",
        `Level must be a whole number from 0 to ${effectiveMaxLevel()}.`,
        "danger"
      );
      return;
    }

    state.activeBand = resolvedBandForLevel(requestedLevel);
    updateRangeDisplay(state.activeBand);
    updateUrl({ level: state.activeLevel, puzzleId: null });
    loadPuzzle().catch(handleLoadError);
  });

  elements.maxLevelInput.addEventListener("change", () => {
    const requestedMaxLevel = Number(elements.maxLevelInput.value);
    if (
      !Number.isInteger(requestedMaxLevel) ||
      requestedMaxLevel < 0 ||
      requestedMaxLevel > ABSOLUTE_MAX_LEVEL
    ) {
      syncMaxLevelInput();
      setMessage(
        "Invalid max level",
        `Max level must be a whole number from 0 to ${ABSOLUTE_MAX_LEVEL}.`,
        "danger"
      );
      return;
    }

    writeConfiguredMaxLevel(requestedMaxLevel);
    applyConfiguredMaxLevel(requestedMaxLevel);
    loadPuzzle({ pushHistory: false }).catch(handleLoadError);
  });
}

async function init() {
  try {
    state.configuredMaxLevel = readConfiguredMaxLevel();
    applySoundEnabled(readSoundEnabled());
    applyStopwatchVisible(readStopwatchVisible());
    audio.prime();
    syncMaxLevelInput();
    await loadMetadata();

    const requestedLevel = parsedLevelFromQuery();
    applyConfiguredMaxLevel(state.configuredMaxLevel);
    state.activeBand = resolvedBandForLevel(requestedLevel ?? levelForBand(currentMetadata().lowestBand));
    updateRangeDisplay(state.activeBand);

    await loadPuzzle({ useQueryPuzzle: state.shouldRestorePuzzleFromQuery });
  } catch (error) {
    handleLoadError(error);
  }
}

bindEventListeners();
updateHistoryControls();
updateHintControl();
syncFlipAccessibilityState();
syncSoundAccessibilityState();
syncStopwatchAccessibilityState();
syncMakeLastMoveAccessibilityState();
renderStopwatch();
setBoardLoadingState(true, "Preparing board...");
init();
