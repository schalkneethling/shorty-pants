/** Word indexes as inclusive ranges, such as [[1, 3], [7, 7]], the form short.json stores. */
export type RemovedWordRanges = [number, number][];

export function removedRangesToIndexes(ranges: RemovedWordRanges): Set<number> {
  const indexes = new Set<number>();
  for (const [fromWord, toWord] of ranges) {
    for (let index = fromWord; index <= toWord; index += 1) {
      indexes.add(index);
    }
  }
  return indexes;
}

export function removedIndexesToRanges(indexes: Set<number>): RemovedWordRanges {
  const sorted = [...indexes].sort((first, second) => first - second);
  const ranges: RemovedWordRanges = [];
  for (const index of sorted) {
    const previous = ranges.at(-1);
    if (previous !== undefined && index === previous[1] + 1) {
      previous[1] = index;
    } else {
      ranges.push([index, index]);
    }
  }
  return ranges;
}

/**
 * Cuts the selected words, or restores them when every one of them is
 * already cut, the way Delete toggles a selection in the editor.
 */
export function toggleRemoved(ranges: RemovedWordRanges, selection: number[]): RemovedWordRanges {
  const removed = removedRangesToIndexes(ranges);
  const isAllRemoved = selection.length > 0 && selection.every((index) => removed.has(index));
  for (const index of selection) {
    if (isAllRemoved) {
      removed.delete(index);
    } else {
      removed.add(index);
    }
  }
  return removedIndexesToRanges(removed);
}
