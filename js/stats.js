// Derives model parameters from raw results. Key decision: a handful of races is
// a tiny sample, so every rate is shrunk toward a prior rather than trusted raw.

const GP_PTS = { 1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1 };
const SP_PTS = { 1: 8, 2: 7, 3: 6, 4: 5, 5: 4, 6: 3, 7: 2, 8: 1 };

const DNF_PRIOR = 0.08;       // baseline per-car DNF rate
const DNF_STRENGTH = 10;      // prior weight, in pseudo-races
const RIVAL_PRIOR = 0.15;     // baseline outsider win rate
const RIVAL_STRENGTH = 8;
const SD_BLEND = 0.5;         // pull each driver's spread halfway to the pooled spread
const DEV_STEADY = 2;         // development slider default (neutral drift)
const PACE_MIN = 1.0;
const PACE_MAX = 6.0;

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pstdev = (xs) => {
  if (xs.length < 2) return 0;
  const mu = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - mu) ** 2)));
};
// Winsorized mean: clamp the k extreme finishes inward so one freak result
// (a lap-one shunt) doesn't define a driver's pace.
const winsorMean = (xs, k = 1) => {
  if (xs.length <= 2 * k) return mean(xs);
  const s = [...xs].sort((a, b) => a - b);
  for (let i = 0; i < k; i++) { s[i] = s[k]; s[s.length - 1 - i] = s[s.length - 1 - k]; }
  return mean(s);
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const finished = (status) => status === 'Finished' || /Laps?$/.test(status);
const isDNF = (row) => !finished(row.status);

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

// Cumulative points per driver after each round; reconstructs the standings
// history so the chart needs no extra data.
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

// season: { standings, results, sprints, schedule }. Returns contenders with
// derived pace/sd/dnf, the outsider win rate, schedule meta, and points history.
export function deriveParams(season, opts = {}) {
  const { standings, results, sprints, schedule } = season;
  const contenderCount = opts.contenderCount ?? 6;
  const agg = aggregate(results);

  // Pooled spread across everyone with more than one finish, used to regularize
  // drivers with too few points (or a freakishly tight one).
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

  const winners = Object.keys(results).map(Number).sort((a, b) => a - b)
    .map((r) => results[r].find((row) => row.position === '1')?.Driver.driverId)
    .filter(Boolean);
  const outsiderWins = winners.filter((w) => !contenderIds.has(w)).length;
  const rivalWin = (outsiderWins + RIVAL_PRIOR * RIVAL_STRENGTH) / (winners.length + RIVAL_STRENGTH);

  // Sprint offsets are indexed from the next race (0 == the very next GP).
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
      sprintRounds: schedule.sprintRounds,
    },
    pointsByRound: pointsByRound(results, sprints),
  };
}

export { DEV_STEADY };
