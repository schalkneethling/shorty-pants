/** Every word index from the anchor to the focus, in order. */
export function selectionBetween(anchor: number, focus: number): number[] {
  const first = Math.min(anchor, focus);
  const last = Math.max(anchor, focus);
  return Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
}

/** Where a key moves the focus in the transcript, or null for other keys. */
export function nextFocusIndex(current: number, key: string, wordCount: number): number | null {
  const lastIndex = wordCount - 1;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return Math.min(current + 1, lastIndex);
    case "ArrowLeft":
    case "ArrowUp":
      return Math.max(current - 1, 0);
    case "Home":
      return 0;
    case "End":
      return lastIndex;
    default:
      return null;
  }
}
