// Jolpica F1 API client. The browser never calls Jolpica directly: it reads the
// committed data/latest.json via loadSnapshot(). loadSeason() (the live fetch)
// runs only in scripts/snapshot.mjs under Node.

const BASE = 'https://api.jolpi.ca/ergast/f1';
const TTL_MS = 1000 * 60 * 30;
const PAGE = 100;

// localStorage is absent under Node, so guard it and no-op there.
const store = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })();

async function cachedJSON(url) {
  const key = 'f1cache:' + url;
  if (store) {
    try {
      const hit = JSON.parse(store.getItem(key) || 'null');
      if (hit && Date.now() - hit.t < TTL_MS) return hit.d;
    } catch { /* ignore corrupt cache */ }
  }
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
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

const SNAPSHOT_URL = 'data/latest.json';
const SNAPSHOT_KEY = 'f1-snapshot';

// On fetch failure, fall back to the last snapshot cached in localStorage so a
// returning visitor still sees data instead of an error.
export async function loadSnapshot() {
  try {
    const res = await fetch(SNAPSHOT_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`snapshot ${res.status}`);
    const data = await res.json();
    if (store) { try { store.setItem(SNAPSHOT_KEY, JSON.stringify(data)); } catch { /* quota */ } }
    return data;
  } catch (err) {
    if (store) {
      const cached = store.getItem(SNAPSHOT_KEY);
      if (cached) return JSON.parse(cached);
    }
    throw err;
  }
}
