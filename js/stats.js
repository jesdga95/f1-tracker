// Turns raw race results into model parameters. The hard part isn't the
// averages; it's that 7 races is a tiny sample, so raw rates lie (a driver
// who hasn't retired yet is NOT a 0%-DNF driver). Every rate is shrunk toward
// a prior whose pull fades as real races accumulate.

const GP_PTS = { 1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1 };
const SP_PTS = { 1: 8, 2: 7, 3: 6, 4: 5, 5: 4, 6: 3, 7: 2, 8: 1 };

// --- priors (the "magic" knobs) ---
const DNF_PRIOR = 0.08;       // baseline per-car DNF rate
const DNF_STRENGTH = 10;      // pseudo-races of prior weight
const RIVAL_PRIOR = 0.15;     // baseline rate an outsider wins a race
const RIVAL_STRENGTH = 8;
const SD_BLEND = 0.5;         // how much to pull each driver's spread toward the pooled spread
const DEV_STEADY = 2;         // default development slider (0..5); 2 == no drift

const PACE_MIN = 1.0;
const PACE_MAX = 6.0;

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pstdev = (xs) => {
  if (xs.length < 2) return 0;
  const mu = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - mu) ** 2)));
};
// Outlier-robust mean: clamp the k highest/lowest values inward before averaging.
// A one-off P12 from a lap-one shunt shouldn't define a driver's pace.
const winsorMean = (xs, k = 1) => {
  if (xs.length <= 2 * k) return mean(xs);
  const s = [...xs].sort((a, b) => a - b);
  for (let i = 0; i < k; i++) { s[i] = s[k]; s[s.length - 1 - i] = s[s.length - 1 - k]; }
  return mean(s);
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const finished = (status) => status === 'Finished' || /Laps?$/.test(status);
const isDNF = (row) => !finished(row.status);

// Aggregate every driver's finishes and retirements across all GP rounds.
function aggregate(results) {
  const agg = {};
  for (const round of Object.keys(results).map(Number).sort((a, b) => a - b)) {
    for (const row of results[round]) {
      const id = row.Driver.driverId;
      const d = (agg[id] ||= { starts: 0, dnf: 0, finishes: [], byRound: {} });
      d.starts += 1;
      if (isDNF(row)) {
        d.dnf += 1;
      } else if (/^\d+$/.test(row.positionText)) {
        const pos = Number(row.position);
        d.finishes.push(pos);
        d.byRound[round] = pos;
      }
    }
  }
  return agg;
}

// Cumulative championship points per driver after each round (GP + sprint).
// Verified to match the live standings exactly, so it's safe to drive the
// historical-odds chart with zero extra API calls.
function pointsByRound(results, sprints) {
  const rounds = [...new Set([...Object.keys(results), ...Object.keys(sprints)])]
    .map(Number).sort((a, b) => a - b);
  const running = {};
  const snapshots = {};
  const add = (rows, table) => {
    for (const row of rows || []) {
      if (/^\d+$/.test(row.positionText)) {
        const id = row.Driver.driverId;
        running[id] = (running[id] || 0) + (table[Number(row.position)] || 0);
      }
    }
  };
  for (const r of rounds) {
    add(results[r], GP_PTS);
    add(sprints[r], SP_PTS);
    snapshots[r] = { ...running };
  }
  return snapshots;
}

/**
 * Derive the full model from a loaded season.
 * @param {object} season - { standings, results, sprints, schedule }
 * @param {object} [opts] - { contenderCount }
 */
export function deriveParams(season, opts = {}) {
  const { standings, results, sprints, schedule } = season;
  const contenderCount = opts.contenderCount ?? 6;
  const agg = aggregate(results);

  // Pooled spread across everyone who has finished more than once, used to
  // regularize drivers with too few data points (or a freakishly tight one).
  const pooledDeviations = [];
  for (const d of Object.values(agg)) {
    if (d.finishes.length > 1) {
      const mu = mean(d.finishes);
      pooledDeviations.push(...d.finishes.map((x) => x - mu));
    }
  }
  const pooledSD = pstdev(pooledDeviations) || 1.6;

  const contenderIds = new Set(
    standings.standings.slice(0, contenderCount).map((s) => s.id)
  );

  const derive = (s) => {
    const a = agg[s.id] || { starts: 0, dnf: 0, finishes: [] };
    const dnf = (a.dnf + DNF_PRIOR * DNF_STRENGTH) / (a.starts + DNF_STRENGTH);
    const pace = a.finishes.length
      ? clamp(winsorMean(a.finishes), PACE_MIN, PACE_MAX)
      : PACE_MAX;
    const own = pstdev(a.finishes);
    const sd = a.finishes.length > 1 ? SD_BLEND * own + (1 - SD_BLEND) * pooledSD : pooledSD;
    return {
      ...s,
      pace: Math.round(pace * 100) / 100,
      sd: Math.round(sd * 100) / 100,
      dnf: Math.round(dnf * 1000) / 1000,
      dev: DEV_STEADY,
    };
  };

  const contenders = standings.standings.slice(0, contenderCount).map(derive);

  // Outsider win rate: fraction of GP wins NOT taken by a modeled contender,
  // shrunk toward the prior so an early run of favourite wins doesn't imply
  // outsiders never win.
  const winners = Object.keys(results).map(Number).sort((a, b) => a - b)
    .map((r) => results[r].find((row) => row.position === '1')?.Driver.driverId)
    .filter(Boolean);
  const outsiderWins = winners.filter((w) => !contenderIds.has(w)).length;
  const rivalWin = (outsiderWins + RIVAL_PRIOR * RIVAL_STRENGTH) / (winners.length + RIVAL_STRENGTH);

  // Remaining schedule: races left and where the sprints fall, indexed from
  // the next race (offset 0 == the very next GP).
  const now = standings.round;
  const sprintOffsets = schedule.sprintRounds
    .filter((sr) => sr > now)
    .map((sr) => sr - now - 1);

  return {
    contenders,
    rivalWin: Math.round(rivalWin * 1000) / 1000,
    meta: {
      round: now,
      totalRounds: schedule.totalRounds,
      gpLeft: schedule.totalRounds - now,
      sprintOffsets,
      sprintsLeft: sprintOffsets.length,
      sprintRounds: schedule.sprintRounds, // absolute, for per-round history re-sims
    },
    pointsByRound: pointsByRound(results, sprints),
  };
}

export { DEV_STEADY };
