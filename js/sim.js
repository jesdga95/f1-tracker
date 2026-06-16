// Monte Carlo over the remaining season for any set of contenders; returns each
// driver's share of simulated championships.

const GP_TABLE = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const SP_TABLE = [8, 7, 6, 5, 4, 3, 2, 1];
const DEV_STEADY = 2;

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand, m, sd) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Development slider (0..5) to a per-race shift in expected finish; 2 is neutral.
export const devToDrift = (dev) => (DEV_STEADY - dev) * 0.015;

function sampleFinish(rand, m, sd, dnf) {
  if (rand() < dnf) return Infinity;
  return Math.max(1, gauss(rand, m, sd));
}

// rivalWin: chance an unmodeled outsider wins, bumping every contender down a slot.
function scoreRace(rand, drivers, means, table, rivalWin, totals) {
  const order = drivers
    .map((d) => [d.id, sampleFinish(rand, means[d.id], d.sd, d.dnf)])
    .filter(([, f]) => Number.isFinite(f))
    .sort((a, b) => a[1] - b[1]);
  let rank = rand() < rivalWin ? 1 : 0;
  for (const [id] of order) { totals[id] += table[rank] || 0; rank += 1; }
}

function simSeason(rand, drivers, schedule) {
  const totals = {};
  const means = {};
  // seasonSigma is the fidelity lever: a one-off per-season pace offset per
  // driver. 0 = strict (data as-is); higher = more upsets.
  const sigma = schedule.seasonSigma || 0;
  for (const d of drivers) {
    totals[d.id] = d.points;
    means[d.id] = d.pace + (sigma ? gauss(rand, 0, sigma) : 0);
  }

  for (let r = 0; r < schedule.nGP; r++) {
    for (const d of drivers) means[d.id] += d.drift;
    scoreRace(rand, drivers, means, GP_TABLE, schedule.rivalWin, totals);
    if (schedule.sprintSet.has(r)) {
      scoreRace(rand, drivers, means, SP_TABLE, schedule.rivalWin, totals);
    }
  }

  let champ = drivers[0].id, best = -Infinity;
  for (const d of drivers) { if (totals[d.id] > best) { best = totals[d.id]; champ = d.id; } }
  return champ;
}

function prepare(contenders, schedule) {
  const drivers = contenders.map((d) => ({
    id: d.id,
    points: d.points,
    pace: d.pace,
    sd: d.sd,
    dnf: d.dnf,
    drift: devToDrift(d.dev ?? DEV_STEADY),
  }));
  const prepared = {
    nGP: schedule.nGP,
    rivalWin: schedule.rivalWin,
    seasonSigma: schedule.seasonSigma || 0,
    sprintSet: schedule.sprintSet instanceof Set
      ? schedule.sprintSet
      : new Set(schedule.sprintOffsets || []),
  };
  return { drivers, prepared };
}

export function simulate(contenders, schedule, runs, seed) {
  const { drivers, prepared } = prepare(contenders, schedule);
  const rand = mulberry32(seed);
  const wins = Object.fromEntries(drivers.map((d) => [d.id, 0]));
  for (let i = 0; i < runs; i++) wins[simSeason(rand, drivers, prepared)] += 1;
  const odds = {};
  for (const d of drivers) odds[d.id] = (wins[d.id] / runs) * 100;
  return odds;
}

// Chunked variant so big runs don't block the UI thread.
export function simulateChunked(contenders, schedule, runs, seed, { onProgress, onDone }) {
  const { drivers, prepared } = prepare(contenders, schedule);
  const rand = mulberry32(seed);
  const wins = Object.fromEntries(drivers.map((d) => [d.id, 0]));
  const CHUNK = 8000;
  let done = 0;

  function step() {
    const batch = Math.min(CHUNK, runs - done);
    for (let i = 0; i < batch; i++) wins[simSeason(rand, drivers, prepared)] += 1;
    done += batch;
    onProgress?.(done / runs);
    if (done < runs) {
      requestAnimationFrame(step);
    } else {
      const odds = {};
      for (const d of drivers) odds[d.id] = (wins[d.id] / runs) * 100;
      onDone(odds);
    }
  }
  requestAnimationFrame(step);
}
