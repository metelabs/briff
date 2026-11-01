export interface Placement {
  column: number;
  /** Offset in px from the top of the grid. */
  top: number;
}

/**
 * Masonry placement: each item, in order, goes to the currently shortest column (ties go left),
 * so the most urgent items stay at the top and reading order runs left-to-right, top-to-bottom.
 */
export function distribute(heights: readonly number[], columns: number, gap: number): Placement[] {
  const totals = Array.from({ length: Math.max(1, columns) }, () => 0);
  return heights.map((h) => {
    let column = 0;
    for (let c = 1; c < totals.length; c++) if (totals[c] < totals[column]) column = c;
    const top = totals[column];
    totals[column] += h + gap;
    return { column, top };
  });
}
