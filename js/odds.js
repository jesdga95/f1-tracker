// Deterministic title-win probability from real per-round standings — no Monte
// Carlo. For a given round, each contender's remaining points are modelled as a
// normal distribution built from their ACTUAL round-by-round scoring that season
// (mean and spread of their real points deltas). The probability a driver is
// champion is then the analytic chance their final total beats every rival's:
//
//   P(i champion) = ∫ f_i(x) · Π_{j≠i} F_j(x) dx
//
// computed by numerical integration (no random sampling). Once a season is over
// (no rounds remain) the points leader is champion outright — 100/0.

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const std = (xs) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

const SQRT2PI = Math.sqrt(2 * Math.PI);
const npdf = (z) => Math.exp(-0.5 * z * z) / SQRT2PI;
// Standard normal CDF via the Abramowitz & Stegun 26.2.17 approximation.
function ncdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const p = npdf(z) * poly;
  return z >= 0 ? 1 - p : p;
}

// Per-driver scoring profile: mean and sd of their real points gained per round.
function profiles(series, ids, N) {
  const cum = (r, id) => series[r]?.[id] ?? 0;
  const out = {};
  for (const id of ids) {
    const deltas = [];
    for (let r = 1; r <= N; r++) deltas.push(cum(r, id) - cum(r - 1, id));
    out[id] = { mu: mean(deltas), sd: std(deltas) };
  }
  return out;
}

function oddsAtRound(R, N, ids, series, prof) {
  const cum = (r, id) => series[r]?.[id] ?? 0;
  const remaining = N - R;

  // Season decided: the points leader takes it.
  if (remaining <= 0) {
    let champ = ids[0], best = -Infinity;
    for (const id of ids) { const p = cum(R, id); if (p > best) { best = p; champ = id; } }
    return Object.fromEntries(ids.map((id) => [id, id === champ ? 100 : 0]));
  }

  // Final-points distribution per driver: points so far + a normal for the rest.
  const dist = ids.map((id) => ({
    id,
    m: cum(R, id) + remaining * prof[id].mu,
    s: Math.max(0.5, Math.sqrt(remaining) * prof[id].sd),
  }));

  const lo = Math.min(...dist.map((d) => d.m - 8 * d.s));
  const hi = Math.max(...dist.map((d) => d.m + 8 * d.s));
  const STEPS = 1024;
  const dx = (hi - lo) / STEPS;

  const win = Object.fromEntries(ids.map((id) => [id, 0]));
  for (let k = 0; k <= STEPS; k++) {
    const x = lo + k * dx;
    const pdf = dist.map((d) => npdf((x - d.m) / d.s) / d.s);
    const cdf = dist.map((d) => ncdf((x - d.m) / d.s));
    for (let i = 0; i < dist.length; i++) {
      let prod = pdf[i];
      if (prod === 0) continue;
      for (let j = 0; j < dist.length; j++) if (j !== i) prod *= cdf[j];
      win[dist[i].id] += prod * dx;
    }
  }

  const tot = Object.values(win).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(ids.map((id) => [id, (win[id] / tot) * 100]));
}

// Returns { round -> { id -> win% } } for every round 1..N, from real standings.
// series: { round -> { id -> cumulative points } }; ids: contender ids (order
// matters only as the countback tiebreak for the settled finale).
export function titleOddsByRound(series, ids, meta) {
  const N = meta.totalRounds;
  const prof = profiles(series, ids, N);
  const out = {};
  for (let R = 1; R <= N; R++) out[R] = oddsAtRound(R, N, ids, series, prof);
  return out;
}
