import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { build } from "esbuild";

const rootDir = process.cwd();
const staticBandsDir = path.join(rootDir, "public", "data", "puzzle_bands");
const docsDir = path.join(rootDir, "docs");
const docsBandsDir = path.join(docsDir, "data", "puzzle_bands");

const imageFiles = [
  "black.bishop.png",
  "black.king.png",
  "black.knight.png",
  "black.pawn.png",
  "black.queen.png",
  "black.rook.png",
  "logo.png",
  "white.bishop.png",
  "white.king.png",
  "white.knight.png",
  "white.pawn.png",
  "white.queen.png",
  "white.rook.png"
];

function withBuildVersion(html, buildVersion) {
  return html
    .replace(/\.\/styles\.css(?:\?[^"]*)?/g, `./styles.css?v=${buildVersion}`)
    .replace(/\.\/app\.js(?:\?[^"]*)?/g, `./app.js?v=${buildVersion}`);
}

async function main() {
  await fs.rm(docsDir, { recursive: true, force: true });
  await fs.mkdir(docsBandsDir, { recursive: true });
  const buildVersion = crypto.randomBytes(6).toString("hex");

  const sourceHtml = await fs.readFile(path.join(rootDir, "index.html"), "utf8");
  const outputHtml = withBuildVersion(sourceHtml, buildVersion);
  await fs.writeFile(path.join(docsDir, "index.html"), outputHtml);
  await fs.writeFile(path.join(docsDir, ".nojekyll"), "");
  process.stdout.write(`Build version ${buildVersion}\n`);

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
    imageFiles.map((file) =>
      fs.copyFile(path.join(rootDir, "img", file), path.join(docsDir, "img", file))
    )
  );

  const metadataPath = path.join(staticBandsDir, "metadata.json");
  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));

  await fs.cp(staticBandsDir, docsBandsDir, { recursive: true });

  const normalizedMetadata = {
    ...metadata,
    availableBands: Array.isArray(metadata.availableBands)
      ? metadata.availableBands.map((band) => Number.parseInt(String(band), 10))
      : [],
    bandCounts:
      metadata.bandCounts && typeof metadata.bandCounts === "object"
        ? Object.fromEntries(
            Object.entries(metadata.bandCounts).map(([band, count]) => [
              String(Number.parseInt(band, 10)),
              Number.parseInt(String(count), 10)
            ])
          )
        : {}
  };

  await fs.writeFile(path.join(docsBandsDir, "metadata.json"), JSON.stringify(normalizedMetadata));
  process.stdout.write(
    `Copied ${normalizedMetadata.availableBands.length} static puzzle bands from ${path.relative(rootDir, staticBandsDir)}\n`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
