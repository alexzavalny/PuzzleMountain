function requiredElement(id) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`[PuzzleMountain] Missing required DOM element #${id}`);
  }

  return element;
}

export const elements = Object.freeze({
  board: requiredElement("board"),
  boardLoader: requiredElement("board-loader"),
  boardLoaderLabel: requiredElement("board-loader-label"),
  boardCaption: requiredElement("board-caption"),
  prevButton: requiredElement("prev-button"),
  hintButton: requiredElement("hint-button"),
  settingsButton: requiredElement("settings-button"),
  settingsDropdown: requiredElement("settings-dropdown"),
  flipToggle: requiredElement("flip-toggle"),
  soundToggle: requiredElement("sound-toggle"),
  maxLevelInput: requiredElement("max-level-input"),
  makeLastMoveToggle: requiredElement("make-last-move-toggle"),
  statsButton: requiredElement("stats-button"),
  soundDebugButton: requiredElement("sound-debug-button"),
  nextButton: requiredElement("next-button"),
  lichessLink: requiredElement("lichess-link"),
  rangeMinNode: requiredElement("range-min"),
  rangeMaxNode: requiredElement("range-max"),
  levelValueNode: requiredElement("level-value"),
  levelForm: requiredElement("level-form"),
  levelInput: requiredElement("level-input"),
  puzzleRatingNode: requiredElement("puzzle-rating"),
  messageBox: requiredElement("message-box"),
  messageTitleNode: requiredElement("message-title"),
  messageBodyNode: requiredElement("message-body"),
  statsModal: requiredElement("stats-modal"),
  statsCloseButton: requiredElement("stats-close-button"),
  soundDebugModal: requiredElement("sound-debug-modal"),
  soundDebugCloseButton: requiredElement("sound-debug-close-button"),
  soundDebugList: requiredElement("sound-debug-list"),
  strongThemesNode: requiredElement("strong-themes"),
  weakThemesNode: requiredElement("weak-themes")
});
