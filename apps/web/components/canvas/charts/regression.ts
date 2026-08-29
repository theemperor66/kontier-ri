/** Least-squares linear regression for client-side trendlines. */

export interface Regression {
  slope: number;
  intercept: number;
  r2: number;
}

export function linearRegression(
  points: ReadonlyArray<readonly [number, number]>,
): Regression | null {
  const pts = points.filter(
    ([x, y]) => Number.isFinite(x) && Number.isFinite(y),
  );
  const n = pts.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of pts) {
    sx += x;
    sy += y;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) * (x - mx);
    sxy += (x - mx) * (y - my);
    syy += (y - my) * (y - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2 };
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string" && v !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return null;
}

/**
 * Return rows with a `trendKey` column following the least-squares fit of
 * `yKey` over the row index (works for categorical x axes). Returns the
 * input unchanged when a fit is not possible.
 */
export function withTrend<T extends Record<string, unknown>>(
  data: T[],
  yKey: string,
  trendKey: string,
): T[] {
  const points: Array<readonly [number, number]> = [];
  data.forEach((row, i) => {
    const y = toNumber(row[yKey]);
    if (y != null) points.push([i, y] as const);
  });
  const fit = linearRegression(points);
  if (!fit) return data;
  return data.map((row, i) => ({
    ...row,
    [trendKey]: fit.intercept + fit.slope * i,
  }));
}
