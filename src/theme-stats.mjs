export function formatThemeLabel(theme) {
  return theme
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function recordThemeOutcome(stats, themes, outcome) {
  const nextStats = { ...stats };

  themes.forEach((theme) => {
    const current = nextStats[theme] && typeof nextStats[theme] === "object" ? nextStats[theme] : {};
    const solved = Number.isFinite(current.solved) ? current.solved : 0;
    const failed = Number.isFinite(current.failed) ? current.failed : 0;

    nextStats[theme] = {
      solved: solved + (outcome === "solved" ? 1 : 0),
      failed: failed + (outcome === "failed" ? 1 : 0)
    };
  });

  return nextStats;
}

export function rankedThemes(stats, predicate, sorter) {
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

export function summarizeThemeStats(stats) {
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

  return { strongThemes, weakThemes };
}
