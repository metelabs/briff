/**
 * Masonry placement: each item, in order, goes to the currently shortest column (ties go left),
 * so the most urgent items stay at the top and reading order runs left-to-right, top-to-bottom.
 */
export function distribute(heights: readonly number[], columns: number, gap: number): number[][] {
  const cols: number[][] = Array.from({ length: Math.max(1, columns) }, () => []);
  const totals = cols.map(() => 0);
  heights.forEach((h, i) => {
    let shortest = 0;
    for (let c = 1; c < totals.length; c++) if (totals[c] < totals[shortest]) shortest = c;
    cols[shortest].push(i);
    totals[shortest] += (cols[shortest].length > 1 ? gap : 0) + h;
  });
  return cols;
}
