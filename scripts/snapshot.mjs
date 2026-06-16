// Builds data/latest.json, the snapshot the site serves. Run by the scheduled
// GitHub Action and locally via `node scripts/snapshot.mjs`.
//
// Hardening: snapshots the most recent season that has standings (so it rolls
// into the next year with no off-season gap), only rewrites when the data
// actually changed, and on any fetch failure throws without writing so the last
// good snapshot stays in place.

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadSeason } from '../js/api.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data');
const latestPath = join(dataDir, 'latest.json');

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
  return { ...s, year };
}

async function currentSeason() {
  const thisYear = Number(process.env.SEASON || process.argv[2]) || new Date().getFullYear();
  try {
    return await seasonWithData(thisYear);
  } catch (e) {
    console.log(`No ${thisYear} data (${e.message}); using ${thisYear - 1}.`);
    return await seasonWithData(thisYear - 1);
  }
}

const season = await currentSeason();
const payload = {
  year: season.year,
  standings: season.standings,
  results: slimByRound(season.results),
  sprints: slimByRound(season.sprints),
  schedule: season.schedule,
};
const serialized = JSON.stringify(payload);

// Skip the write (and therefore the commit) when only the timestamp would change.
let unchanged = false;
try {
  const { fetchedAt, ...prev } = JSON.parse(readFileSync(latestPath, 'utf8'));
  unchanged = JSON.stringify(prev) === serialized;
} catch { /* no prior snapshot */ }

if (unchanged) {
  console.log(`No change for ${season.year} round ${season.standings.round}.`);
  process.exit(0);
}

mkdirSync(dataDir, { recursive: true });
writeFileSync(latestPath, JSON.stringify({ ...payload, fetchedAt: new Date().toISOString() }));
const top = season.standings.standings.slice(0, 3).map((s) => `${s.name} ${s.points}`).join(', ');
console.log(`Wrote data/latest.json | ${season.year} round ${season.standings.round} | ${top}`);
