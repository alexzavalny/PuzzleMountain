# PuzzleMountain

Static GitHub Pages site for climbing through the Lichess puzzle database in 50-point rating bands.

## Rules

- Start at the lowest indexed puzzle rating band.
- Solve the full line correctly to move up by 50 rating points.
- A wrong move keeps you in the same band.
- There are no lives, penalties, or rating drops.

## Build

1. Generate the publishable static site:

   ```bash
   npm run build
   ```

2. Publish the generated `docs/` directory with GitHub Pages.

3. For local preview, serve `docs/` with any static file server.

## Source layout

- `src/` contains the application source code, split by responsibility:
  - `app.mjs` wires the UI together.
  - `audio.mjs`, `puzzle-repository.mjs`, and `preferences.mjs` handle runtime services.
  - `lib/` contains pure helpers for chess and level logic.
- `public/` contains static assets only: styles, audio, and prebuilt puzzle-band data.
- `docs/` is generated output for GitHub Pages and should be treated as a build artifact.

## Verification

```bash
npm test
npm run build
```

## Notes

- Raw source CSV bands live in `/Users/alex/Projects/PuzzleMountain/data/puzzle_bands`.
- Prebuilt puzzle-band JSON lives in `/Users/alex/Projects/PuzzleMountain/public/data/puzzle_bands`.
- `npm run build` copies the static puzzle-band JSON into `/Users/alex/Projects/PuzzleMountain/docs/data/puzzle_bands`.
- The published site is entirely static: no Ruby, no server routes, no backend state.
- Runtime state lives in the URL query string using `level` and `puzzle`.
- The puzzle board is shown after the first move from the Lichess solution line, matching the dataset specification.
