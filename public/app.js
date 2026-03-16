const boardElement = document.getElementById("board");
const boardCaption = document.getElementById("board-caption");
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

const BASE_URL = new URL(".", window.location.href);
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];
const PIECE_FILES = {
  P: "img/white.pawn.png",
  N: "img/white.knight.png",
  B: "img/white.bishop.png",
  R: "img/white.rook.png",
  Q: "img/white.queen.png",
  K: "img/white.king.png",
  p: "img/black.pawn.png",
  n: "img/black.knight.png",
  b: "img/black.bishop.png",
  r: "img/black.rook.png",
  q: "img/black.queen.png",
  k: "img/black.king.png"
};
const PIECES = Object.fromEntries(
  Object.entries(PIECE_FILES).map(([piece, relativePath]) => [piece, new URL(relativePath, BASE_URL).toString()])
);

let metadata = null;
let activePuzzle = null;
let activeBand = null;
let activeLevel = 0;
let solutionIndex = 0;
let solvedCurrentPuzzle = false;
let selectedSquare = null;
let playerColor = "w";
let lastMoveSquares = [];
let boardState = {};
let bandCache = new Map();
let shouldRestorePuzzleFromQuery = true;
let gameState = {
  turn: "w",
  castling: "-",
  enPassant: "-"
};

function assetUrl(relativePath) {
  return new URL(relativePath, BASE_URL).toString();
}

function setMessage(title, body, tone = "neutral") {
  const box = document.getElementById("message-box");
  box.dataset.tone = tone;
  messageTitleNode.textContent = title;
  messageBodyNode.textContent = body;
}

function squareColor(fileIndex, rankIndex) {
  return (fileIndex + rankIndex) % 2 === 0 ? "light" : "dark";
}

function fileIndex(file) {
  return FILES.indexOf(file);
}

function squareCoords(square) {
  return {
    file: square[0],
    rank: Number(square[1]),
    fileIndex: fileIndex(square[0])
  };
}

function coordsToSquare(fileIdx, rank) {
  return `${FILES[fileIdx]}${rank}`;
}

function cloneBoard(board) {
  return { ...board };
}

function parseFen(fen) {
  const [placement, turn, castling, enPassant] = fen.split(" ");
  const board = {};
  const ranks = placement.split("/");

  ranks.forEach((rankString, rankOffset) => {
    let fileIdx = 0;
    const rank = 8 - rankOffset;

    rankString.split("").forEach((char) => {
      if (/\d/.test(char)) {
        fileIdx += Number(char);
      } else {
        board[coordsToSquare(fileIdx, rank)] = char;
        fileIdx += 1;
      }
    });
  });

  return {
    board,
    state: {
      turn,
      castling,
      enPassant
    }
  };
}

function boardSquares() {
  const files = playerColor === "w" ? FILES : [...FILES].reverse();
  const ranks = playerColor === "w" ? RANKS : [...RANKS].reverse();
  const squares = [];

  ranks.forEach((rank, rankIndex) => {
    files.forEach((file, fileIndexValue) => {
      squares.push({
        name: `${file}${rank}`,
        file,
        rank,
        rankIndex,
        fileIndex: fileIndexValue
      });
    });
  });

  return squares;
}

function pieceAt(square) {
  return PIECES[boardState[square]] || null;
}

function pieceColor(piece) {
  return piece === piece.toUpperCase() ? "w" : "b";
}

function sameSquare(a, b) {
  return a && b && a[0] === b[0] && a[1] === b[1];
}

function isPathClear(from, to, board) {
  const fromCoords = squareCoords(from);
  const toCoords = squareCoords(to);
  const fileStep = Math.sign(toCoords.fileIndex - fromCoords.fileIndex);
  const rankStep = Math.sign(toCoords.rank - fromCoords.rank);

  let currentFile = fromCoords.fileIndex + fileStep;
  let currentRank = fromCoords.rank + rankStep;

  while (currentFile !== toCoords.fileIndex || currentRank !== toCoords.rank) {
    if (board[coordsToSquare(currentFile, currentRank)]) {
      return false;
    }

    currentFile += fileStep;
    currentRank += rankStep;
  }

  return true;
}

function isLegalDestination(from, to) {
  const piece = boardState[from];
  if (!piece) {
    return false;
  }

  const target = boardState[to];
  if (target && pieceColor(target) === pieceColor(piece)) {
    return false;
  }

  const fromCoords = squareCoords(from);
  const toCoords = squareCoords(to);
  const fileDelta = toCoords.fileIndex - fromCoords.fileIndex;
  const rankDelta = toCoords.rank - fromCoords.rank;
  const absFile = Math.abs(fileDelta);
  const absRank = Math.abs(rankDelta);
  const lower = piece.toLowerCase();
  const color = pieceColor(piece);
  const forward = color === "w" ? 1 : -1;
  const startRank = color === "w" ? 2 : 7;

  if (lower === "p") {
    if (fileDelta === 0) {
      if (!target && rankDelta === forward) {
        return true;
      }

      if (
        !target &&
        rankDelta === forward * 2 &&
        fromCoords.rank === startRank &&
        !boardState[coordsToSquare(fromCoords.fileIndex, fromCoords.rank + forward)]
      ) {
        return true;
      }
    }

    if (absFile === 1 && rankDelta === forward) {
      return Boolean(target) || sameSquare(to, gameState.enPassant);
    }

    return false;
  }

  if (lower === "n") {
    return (absFile === 1 && absRank === 2) || (absFile === 2 && absRank === 1);
  }

  if (lower === "b") {
    return absFile === absRank && isPathClear(from, to, boardState);
  }

  if (lower === "r") {
    return (fileDelta === 0 || rankDelta === 0) && isPathClear(from, to, boardState);
  }

  if (lower === "q") {
    return (
      (absFile === absRank || fileDelta === 0 || rankDelta === 0) &&
      isPathClear(from, to, boardState)
    );
  }

  if (lower === "k") {
    if (absFile <= 1 && absRank <= 1) {
      return true;
    }

    if (absRank === 0 && absFile === 2) {
      return true;
    }
  }

  return false;
}

function targetSquaresFor(square) {
  const piece = boardState[square];
  if (!piece || pieceColor(piece) !== gameState.turn) {
    return [];
  }

  return Object.keys(boardState)
    .concat(FILES.flatMap((file) => RANKS.map((rank) => `${file}${rank}`)))
    .filter((target, index, all) => {
      if (target === square) {
        return false;
      }

      return all.indexOf(target) === index && isLegalDestination(square, target);
    });
}

function renderBoard() {
  const targets = selectedSquare ? targetSquaresFor(selectedSquare) : [];
  boardElement.innerHTML = "";

  boardSquares().forEach((square) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "square";
    button.dataset.square = square.name;
    button.dataset.color = squareColor(square.fileIndex, square.rankIndex);
    button.dataset.selected = String(selectedSquare === square.name);
    button.dataset.target = String(targets.includes(square.name));
    button.dataset.lastMove = String(lastMoveSquares.includes(square.name));

    const pieceSrc = pieceAt(square.name);
    if (pieceSrc) {
      const piece = document.createElement("img");
      piece.className = "piece";
      piece.src = pieceSrc;
      piece.alt = "";
      piece.draggable = false;
      button.appendChild(piece);
    }

    if ((playerColor === "w" && square.rank === "1") || (playerColor === "b" && square.rank === "8")) {
      const fileLabel = document.createElement("span");
      fileLabel.className = "square-label";
      fileLabel.textContent = square.file;
      button.appendChild(fileLabel);
    } else if ((playerColor === "w" && square.file === "a") || (playerColor === "b" && square.file === "h")) {
      const rankLabel = document.createElement("span");
      rankLabel.className = "square-label";
      rankLabel.textContent = square.rank;
      button.appendChild(rankLabel);
    }

    button.addEventListener("click", () => handleSquareClick(square.name));
    boardElement.appendChild(button);
  });
}

function updateCastlingRights(piece, from, to, capturedPiece) {
  let rights = gameState.castling === "-" ? "" : gameState.castling;

  const remove = (chars) => {
    rights = rights
      .split("")
      .filter((char) => !chars.includes(char))
      .join("");
  };

  if (piece === "K") {
    remove(["K", "Q"]);
  } else if (piece === "k") {
    remove(["k", "q"]);
  } else if (piece === "R") {
    if (from === "h1") remove(["K"]);
    if (from === "a1") remove(["Q"]);
  } else if (piece === "r") {
    if (from === "h8") remove(["k"]);
    if (from === "a8") remove(["q"]);
  }

  if (capturedPiece === "R") {
    if (to === "h1") remove(["K"]);
    if (to === "a1") remove(["Q"]);
  } else if (capturedPiece === "r") {
    if (to === "h8") remove(["k"]);
    if (to === "a8") remove(["q"]);
  }

  gameState.castling = rights || "-";
}

function applyMove(uci) {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci[4];
  const piece = boardState[from];
  const targetPiece = boardState[to];
  const fromCoords = squareCoords(from);
  const toCoords = squareCoords(to);
  const nextBoard = cloneBoard(boardState);

  delete nextBoard[from];

  if (piece.toLowerCase() === "p" && sameSquare(to, gameState.enPassant) && !targetPiece) {
    const capturedRank = pieceColor(piece) === "w" ? toCoords.rank - 1 : toCoords.rank + 1;
    delete nextBoard[coordsToSquare(toCoords.fileIndex, capturedRank)];
  }

  if (piece.toLowerCase() === "k" && Math.abs(toCoords.fileIndex - fromCoords.fileIndex) === 2) {
    if (to === "g1") {
      nextBoard.f1 = nextBoard.h1;
      delete nextBoard.h1;
    } else if (to === "c1") {
      nextBoard.d1 = nextBoard.a1;
      delete nextBoard.a1;
    } else if (to === "g8") {
      nextBoard.f8 = nextBoard.h8;
      delete nextBoard.h8;
    } else if (to === "c8") {
      nextBoard.d8 = nextBoard.a8;
      delete nextBoard.a8;
    }
  }

  nextBoard[to] = promotion
    ? pieceColor(piece) === "w"
      ? promotion.toUpperCase()
      : promotion.toLowerCase()
    : piece;

  boardState = nextBoard;
  updateCastlingRights(piece, from, to, targetPiece);

  if (piece.toLowerCase() === "p" && Math.abs(toCoords.rank - fromCoords.rank) === 2) {
    const middleRank = (fromCoords.rank + toCoords.rank) / 2;
    gameState.enPassant = coordsToSquare(fromCoords.fileIndex, middleRank);
  } else {
    gameState.enPassant = "-";
  }

  gameState.turn = gameState.turn === "w" ? "b" : "w";
  return { from, to };
}

function syncBoard(lastMove = null) {
  lastMoveSquares = lastMove ? [lastMove.from, lastMove.to] : [];
  renderBoard();
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
  const parsed = parseFen(puzzle.fen);
  boardState = parsed.board;
  gameState = parsed.state;
  const setupMove = applyMove(puzzle.setupMove);
  playerColor = gameState.turn;
  boardCaption.textContent = playerColor === "w" ? "White to move." : "Black to move.";
  syncBoard(setupMove);
}

async function loadPuzzle({ useQueryPuzzle = false } = {}) {
  setMessage("Loading puzzle", "Loading static puzzle data for your current band.");
  nextButton.disabled = true;
  lichessLink.classList.add("hidden");

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

  activePuzzle = puzzle;
  solutionIndex = 0;
  solvedCurrentPuzzle = false;
  selectedSquare = null;
  shouldRestorePuzzleFromQuery = false;

  updateRangeDisplay(band);
  updateUrl({ level: activeLevel, puzzleId: activePuzzle.id });
  puzzleRatingNode.textContent = `Rating ${activePuzzle.rating}`;
  lichessLink.href = activePuzzle.lichessUrl;
  console.log("[PuzzleMountain] Puzzle selected", {
    id: activePuzzle.id,
    rating: activePuzzle.rating,
    band,
    level: activeLevel
  });

  applyPuzzleToBoard(activePuzzle);
  setMessage("Your move", "Find the first move of the solution line.");
}

async function handleSolved() {
  solvedCurrentPuzzle = true;
  setMessage("Correct", "You climbed 50 rating points. Loading the next puzzle.", "success");

  activeBand = normalizedBandForLevel(activeLevel + 1);
  updateRangeDisplay(activeBand);
  updateUrl({ level: activeLevel, puzzleId: null });

  window.setTimeout(() => {
    loadPuzzle().catch(handleLoadError);
  }, 900);
}

function handleFailure() {
  activeBand = normalizedBandForLevel(Math.max(activeLevel - 1, 0));
  updateRangeDisplay(activeBand);
  updateUrl({ level: activeLevel, puzzleId: null });
  selectedSquare = null;
  renderBoard();
  setMessage("Wrong", "That move does not match the solution. You dropped one level.", "danger");
  lichessLink.classList.remove("hidden");
  nextButton.disabled = false;
}

function playExpectedReplyIfNeeded() {
  if (solutionIndex >= activePuzzle.solution.length) {
    handleSolved();
    return;
  }

  const reply = activePuzzle.solution[solutionIndex];
  const replyMove = applyMove(reply);
  solutionIndex += 1;
  selectedSquare = null;
  syncBoard(replyMove);

  if (solutionIndex >= activePuzzle.solution.length) {
    handleSolved();
  } else {
    setMessage("Keep going", "Good. The reply was played. Find the next move.", "success");
  }
}

function submitMove(from, to) {
  if (!activePuzzle || solvedCurrentPuzzle) {
    return;
  }

  const expected = activePuzzle.solution[solutionIndex];
  const attempted = `${from}${to}${expected.length > 4 ? expected.slice(4, 5) : ""}`;

  if (attempted !== expected) {
    handleFailure();
    return;
  }

  const result = applyMove(expected);
  solutionIndex += 1;
  selectedSquare = null;
  syncBoard(result);
  window.setTimeout(playExpectedReplyIfNeeded, 350);
}

function handleSquareClick(square) {
  if (!activePuzzle || solvedCurrentPuzzle) {
    return;
  }

  const piece = boardState[square];

  if (!selectedSquare) {
    if (piece && pieceColor(piece) === gameState.turn) {
      selectedSquare = square;
      renderBoard();
    }
    return;
  }

  if (selectedSquare === square) {
    selectedSquare = null;
    renderBoard();
    return;
  }

  if (piece && pieceColor(piece) === gameState.turn) {
    selectedSquare = square;
    renderBoard();
    return;
  }

  submitMove(selectedSquare, square);
}

function handleLoadError(error) {
  console.error("[PuzzleMountain] Load error", error);
  nextButton.disabled = false;
  setMessage("Load failed", error.message, "danger");
}

nextButton.addEventListener("click", () => {
  loadPuzzle().catch(handleLoadError);
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

renderBoard();
init();
