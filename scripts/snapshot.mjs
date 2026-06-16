// Builds the data snapshots the site serves: one data/{year}.json per season
// plus a data/seasons.json manifest. Run by the scheduled GitHub Action and
// locally via `node scripts/snapshot.mjs`.
//
// Hardening: resolves the most recent season that has standings (so it rolls
// into the next year with no off-season gap). The live season is refreshed every
// run; past seasons (back to EARLIEST_YEAR) are fetched ONCE to capture their
// official per-round standings, then trusted from the committed snapshot and
// never re-fetched. Each file is only rewritten when its data actually changed,
// and on any fetch failure that season is skipped so the last good snapshot stays.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadSeason, getStandingsByRound } from '../js/api.js';

// Oldest season to snapshot for the wayback view (data exists well before this,
// but 2020 is a sensible floor for the current grid + liveries).
const EARLIEST_YEAR = 2020;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data');
const yearPath = (year) => join(dataDir, `${year}.json`);
const manifestPath = join(dataDir, 'seasons.json');

// Keep only the fields the model reads (see js/stats.js).
const slimRow = (r) => ({
  position: r.position,
  positionText: r.positionText,
  status: r.status,
  Driver: { driverId: r.Driver.driverId },
});
const slimByRound = (byRound) =>
  Object.fromEntries(Object.entries(byRound).map(([rnd, rows]) => [rnd, rows.map(slimRow)]));

async function seasonWithData(year) {
  const s = await loadSeason(year);
  if (!s.standings.standings.length) throw new Error(`no standings for ${year}`);
  const out = { ...s, year };
  // Completed season → snapshot the real per-round standings for the wayback view.
  if (s.standings.round >= s.schedule.totalRounds) {
    out.standingsByRound = await getStandingsByRound(year, s.schedule.totalRounds);
  }
  return out;
}

// The live season: this calendar year, or the year before if it hasn't started.
async function liveSeason() {
  const thisYear = Number(process.env.SEASON || process.argv[2]) || new Date().getFullYear();
  try {
    return await seasonWithData(thisYear);
  } catch (e) {
    console.log(`No ${thisYear} data (${e.message}); using ${thisYear - 1}.`);
    return await seasonWithData(thisYear - 1);
  }
}

const payloadOf = (season) => ({
  year: season.year,
  standings: season.standings,
  results: slimByRound(season.results),
  sprints: slimByRound(season.sprints),
  schedule: season.schedule,
  ...(season.standingsByRound ? { standingsByRound: season.standingsByRound } : {}),
});

// Write data/{year}.json only when the data (ignoring the timestamp) changed.
// Returns true if the season is now present on disk (written or already current).
function writeSeason(season) {
  const payload = payloadOf(season);
  const serialized = JSON.stringify(payload);

  let unchanged = false;
  try {
    const { fetchedAt, ...prev } = JSON.parse(readFileSync(yearPath(season.year), 'utf8'));
    unchanged = JSON.stringify(prev) === serialized;
  } catch { /* no prior snapshot */ }

  if (unchanged) {
    console.log(`No change for ${season.year} round ${season.standings.round}.`);
    return true;
  }

  writeFileSync(yearPath(season.year), JSON.stringify({ ...payload, fetchedAt: new Date().toISOString() }));
  const top = season.standings.standings.slice(0, 3).map((s) => `${s.name} ${s.points}`).join(', ');
  console.log(`Wrote data/${season.year}.json | round ${season.standings.round} | ${top}`);
  return true;
}

function writeManifest(manifest) {
  const serialized = JSON.stringify(manifest);
  let unchanged = false;
  try { unchanged = readFileSync(manifestPath, 'utf8') === serialized; } catch { /* none */ }
  if (unchanged) return;
  writeFileSync(manifestPath, serialized);
  console.log(`Wrote data/seasons.json | years ${manifest.years.join(', ')}`);
}

mkdirSync(dataDir, { recursive: true });

const live = await liveSeason();
const years = [live.year];
writeSeason(live);

// A finalized past season (committed file that already carries the official
// per-round standings) is immutable — never re-fetch it. We only reach out for
// a year that's missing or not yet finalized (first backfill, or a season that
// has just completed). So the scheduled job normally touches only the live year.
function finalized(y) {
  try { return !!JSON.parse(readFileSync(yearPath(y), 'utf8')).standingsByRound; }
  catch { return false; }
}

for (let y = live.year - 1; y >= EARLIEST_YEAR; y--) {
  if (finalized(y)) { years.push(y); continue; }   // trust the committed snapshot
  try {
    writeSeason(await seasonWithData(y));
    years.push(y);
  } catch (e) {
    // Keep a year already snapshotted on a prior run even if today's fetch failed.
    if (existsSync(yearPath(y))) { years.push(y); console.log(`Kept existing ${y}: ${e.message}`); }
    else console.log(`Skipping ${y}: ${e.message}`);
  }
}

// The manifest is just the set of seasons we have. The app shows the newest one
// live only while its season is in progress (this calendar year, races left);
// otherwise it, too, is a read-only replay. So no "current" flag is needed here.
writeManifest({ years: years.sort((a, b) => a - b) });
