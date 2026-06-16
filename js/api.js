// Jolpica F1 API client. The browser never calls Jolpica directly: it reads the
// committed data/latest.json via loadSnapshot(). loadSeason() (the live fetch)
// runs only in scripts/snapshot.mjs under Node.

const BASE = 'https://api.jolpi.ca/ergast/f1';
const TTL_MS = 1000 * 60 * 30;
const PAGE = 100;

// localStorage is absent under Node, so guard it and no-op there.
const store = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cachedJSON(url, attempt = 0) {
  const key = 'f1cache:' + url;
  if (store) {
    try {
      const hit = JSON.parse(store.getItem(key) || 'null');
      if (hit && Date.now() - hit.t < TTL_MS) return hit.d;
    } catch { /* ignore corrupt cache */ }
  }
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  // Jolpica rate-limits (429); back off and retry rather than abort the snapshot.
  if ((res.status === 429 || res.status >= 500) && attempt < 6) {
    const retryAfter = Number(res.headers.get('retry-after')) || 0;
    await sleep(retryAfter ? retryAfter * 1000 : Math.min(10000, 600 * 2 ** attempt));
    return cachedJSON(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`Jolpica ${res.status} on ${url}`);
  const d = await res.json();
  if (store) {
    try { store.setItem(key, JSON.stringify({ t: Date.now(), d })); } catch { /* quota */ }
  }
  return d;
}

async function paginate(path, collect) {
  let offset = 0;
  for (;;) {
    const d = (await cachedJSON(`${BASE}/${path}?limit=${PAGE}&offset=${offset}`)).MRData;
    collect(d);
    offset += PAGE;
    if (offset >= Number(d.total)) break;
  }
}

export async function getStandings(year) {
  const list = (await cachedJSON(`${BASE}/${year}/driverStandings/`))
    .MRData.StandingsTable.StandingsLists[0];
  return {
    round: Number(list.round),
    standings: list.DriverStandings.map((r) => ({
      id: r.Driver.driverId,
      name: r.Driver.familyName,
      code: r.Driver.code || r.Driver.familyName.slice(0, 3).toUpperCase(),
      num: r.Driver.permanentNumber || '',
      team: r.Constructors[0].name,
      points: Number(r.points),
      wins: Number(r.wins),
    })),
  };
}

// Official cumulative points after each round: { round -> { driverId -> points } }.
// One call per round, so reserve it for completed (wayback) seasons in the
// snapshot. This is the real championship as it stood, fastest-lap points,
// sprint-format quirks, half-points races and penalties all included.
export async function getStandingsByRound(year, rounds) {
  const byRound = {};
  for (let r = 1; r <= rounds; r++) {
    if (r > 1) await sleep(250);   // stay under Jolpica's burst limit
    const lists = (await cachedJSON(`${BASE}/${year}/${r}/driverStandings/`))
      .MRData.StandingsTable.StandingsLists;
    if (!lists.length) continue;
    byRound[r] = Object.fromEntries(
      lists[0].DriverStandings.map((s) => [s.Driver.driverId, Number(s.points)])
    );
  }
  return byRound;
}

export async function getResults(year) {
  const byRound = {};
  await paginate(`${year}/results/`, (d) => {
    for (const race of d.RaceTable.Races) {
      (byRound[Number(race.round)] ||= []).push(...(race.Results || []));
    }
  });
  return byRound;
}

export async function getSprintResults(year) {
  const byRound = {};
  await paginate(`${year}/sprint/`, (d) => {
    for (const race of d.RaceTable.Races) {
      (byRound[Number(race.round)] ||= []).push(...(race.SprintResults || []));
    }
  });
  return byRound;
}

export async function getSchedule(year) {
  const races = (await cachedJSON(`${BASE}/${year}/?limit=${PAGE}`)).MRData.RaceTable.Races;
  return {
    totalRounds: races.length,
    sprintRounds: races.filter((r) => 'Sprint' in r).map((r) => Number(r.round)),
  };
}

export async function loadSeason(year) {
  const [standings, results, sprints, schedule] = await Promise.all([
    getStandings(year),
    getResults(year),
    getSprintResults(year),
    getSchedule(year),
  ]);
  return { standings, results, sprints, schedule };
}

// On fetch failure, fall back to the last copy cached in localStorage so a
// returning visitor still sees data instead of an error.
async function loadCached(url, key) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    const data = await res.json();
    if (store) { try { store.setItem(key, JSON.stringify(data)); } catch { /* quota */ } }
    return data;
  } catch (err) {
    if (store) {
      const cached = store.getItem(key);
      if (cached) return JSON.parse(cached);
    }
    throw err;
  }
}

// Lists the available seasons: { current, years: [...] }. `current` is the live
// (tunable) season; the rest are the read-only wayback set.
export function loadManifest() {
  return loadCached('data/seasons.json', 'f1-manifest');
}

// One season's committed snapshot: { year, standings, results, sprints, schedule }.
export function loadSeasonSnapshot(year) {
  return loadCached(`data/${year}.json`, `f1-snapshot:${year}`);
}
