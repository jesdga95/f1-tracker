// Thin client for the Jolpica F1 API (the open, Ergast-compatible successor).
// Everything we need for the model comes from four endpoints. Responses are
// cached in localStorage with a TTL so we don't hammer the API (it's rate
// limited to a few requests/second, ~500/day anonymous). Standings only
// change ~22 times a year, so a long TTL is fine.

const BASE = 'https://api.jolpi.ca/ergast/f1';
const TTL_MS = 1000 * 60 * 30; // 30 minutes
const PAGE = 100;              // Jolpica's max page size

// localStorage exists in the browser but not when this module is reused by the
// snapshot script under Node, so guard it and degrade to no caching there.
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

// Walk every page of a paginated MRData list and hand each page to `collect`.
async function paginate(path, collect) {
  let offset = 0;
  for (;;) {
    const d = (await cachedJSON(`${BASE}/${path}?limit=${PAGE}&offset=${offset}`)).MRData;
    collect(d);
    offset += PAGE;
    if (offset >= Number(d.total)) break;
  }
}

// Current driver standings: leader, points, wins, names, numbers, teams.
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

// Every race result of the season, grouped by round. Used to derive pace,
// reliability and the per-round historical standings.
export async function getResults(year) {
  const byRound = {};
  await paginate(`${year}/results/`, (d) => {
    for (const race of d.RaceTable.Races) {
      (byRound[Number(race.round)] ||= []).push(...(race.Results || []));
    }
  });
  return byRound;
}

// Sprint results, grouped by round (separate, lighter points table).
export async function getSprintResults(year) {
  const byRound = {};
  await paginate(`${year}/sprint/`, (d) => {
    for (const race of d.RaceTable.Races) {
      (byRound[Number(race.round)] ||= []).push(...(race.SprintResults || []));
    }
  });
  return byRound;
}

// Full calendar: total rounds and which weekends are sprints.
export async function getSchedule(year) {
  const races = (await cachedJSON(`${BASE}/${year}/?limit=${PAGE}`)).MRData.RaceTable.Races;
  return {
    totalRounds: races.length,
    sprintRounds: races.filter((r) => 'Sprint' in r).map((r) => Number(r.round)),
  };
}

// One call site to load everything the model needs straight from Jolpica.
export async function loadSeason(year) {
  const [standings, results, sprints, schedule] = await Promise.all([
    getStandings(year),
    getResults(year),
    getSprintResults(year),
    getSchedule(year),
  ]);
  return { standings, results, sprints, schedule };
}

// Pre-baked snapshot committed to the repo by the scheduled GitHub Action.
// Reading this means a normal visit makes zero calls to the third-party API.
export async function loadSeasonSnapshot(year) {
  const res = await fetch(`data/${year}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`no snapshot for ${year} (${res.status})`);
  return res.json();
}

// Prefer the committed snapshot; fall back to a live fetch (local dev before the
// first snapshot exists, or if the file is somehow missing).
export async function loadSeasonPreferSnapshot(year) {
  try {
    return await loadSeasonSnapshot(year);
  } catch {
    return loadSeason(year);
  }
}
