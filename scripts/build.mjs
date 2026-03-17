import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { build } from "esbuild";

const rootDir = process.cwd();
const sourceBandsDir = path.join(rootDir, "data", "puzzle_bands");
const docsDir = path.join(rootDir, "docs");
const docsBandsDir = path.join(docsDir, "data", "puzzle_bands");

const pieceFiles = [
  "black.bishop.png",
  "black.king.png",
  "black.knight.png",
  "black.pawn.png",
  "black.queen.png",
  "black.rook.png",
  "white.bishop.png",
  "white.king.png",
  "white.knight.png",
  "white.pawn.png",
  "white.queen.png",
  "white.rook.png"
];

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        value += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(value);
      value = "";
      continue;
    }

    value += char;
  }

  values.push(value);
  return values;
}

function normalizeGameUrl(url) {
  return url.includes("#") ? url : `${url}#last`;
}

function rowToPuzzle(row) {
  const moves = row[2].split(" ").filter(Boolean);

  return {
    id: row[0],
    fen: row[1],
    rating: Number(row[3]),
    themes: row[7] ? row[7].split(" ").filter(Boolean) : [],
    lichessUrl: normalizeGameUrl(row[8]),
    setupMove: moves[0],
    solution: moves.slice(1)
  };
}

async function buildBandJson(csvPath, jsonPath) {
  const puzzles = [];
  const stream = createReadStream(csvPath, { encoding: "utf8" });
  const lineReader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;

  for await (const line of lineReader) {
    lineNumber += 1;
    if (lineNumber === 1 || !line.trim()) {
      continue;
    }

    const row = parseCsvLine(line);
    if (row.length < 9) {
      continue;
    }

    puzzles.push(rowToPuzzle(row));
  }

  await fs.writeFile(jsonPath, JSON.stringify(puzzles));
  return puzzles.length;
}

async function main() {
  await fs.rm(docsDir, { recursive: true, force: true });
  await fs.mkdir(docsBandsDir, { recursive: true });

  await fs.copyFile(path.join(rootDir, "index.html"), path.join(docsDir, "index.html"));
  await fs.writeFile(path.join(docsDir, ".nojekyll"), "");

  const [baseCss, boardCss, pieceCss, appCss] = await Promise.all([
    fs.readFile(path.join(rootDir, "node_modules", "@lichess-org", "chessground", "assets", "chessground.base.css"), "utf8"),
    fs.readFile(path.join(rootDir, "node_modules", "@lichess-org", "chessground", "assets", "chessground.brown.css"), "utf8"),
    fs.readFile(path.join(rootDir, "node_modules", "@lichess-org", "chessground", "assets", "chessground.cburnett.css"), "utf8"),
    fs.readFile(path.join(rootDir, "public", "styles.css"), "utf8")
  ]);

  await fs.writeFile(path.join(docsDir, "styles.css"), `${baseCss}\n${boardCss}\n${pieceCss}\n${appCss}`);
  await build({
    entryPoints: [path.join(rootDir, "public", "app.js")],
    bundle: true,
    format: "iife",
    platform: "browser",
    outfile: path.join(docsDir, "app.js"),
    sourcemap: false,
    minify: false
  });

  await fs.mkdir(path.join(docsDir, "img"), { recursive: true });
  await Promise.all(
    pieceFiles.map((file) =>
      fs.copyFile(path.join(rootDir, "img", file), path.join(docsDir, "img", file))
    )
  );

  const bandEntries = (await fs.readdir(sourceBandsDir))
    .filter((entry) => /^\d+\.csv$/.test(entry))
    .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));

  const bandCounts = {};
  const availableBands = [];

  for (const entry of bandEntries) {
    const band = Number.parseInt(entry, 10);
    const count = await buildBandJson(
      path.join(sourceBandsDir, entry),
      path.join(docsBandsDir, `${band}.json`)
    );

    bandCounts[band] = count;
    availableBands.push(band);
    process.stdout.write(`Built band ${band} (${count} puzzles)\n`);
  }

  await fs.writeFile(
    path.join(docsBandsDir, "metadata.json"),
    JSON.stringify({
      bandSize: 50,
      availableBands,
      bandCounts,
      lowestBand: availableBands[0] ?? 0
    })
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
