export function toCgColor(color) {
  return color === "w" ? "white" : "black";
}

export function uciToMove(uci) {
  return {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci.slice(4, 5) : undefined
  };
}

function uniqueDestinations(moves) {
  return [...new Set(moves.map((move) => move.to))];
}

export function computeDests(chess) {
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
