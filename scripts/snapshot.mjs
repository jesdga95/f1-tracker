// Fetches the current season from Jolpica and writes data/<year>.json.
// Run by the scheduled GitHub Action (and runnable locally: `node scripts/snapshot.mjs`).
// Reuses js/api.js so the snapshot shape always matches what the app expects.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadSeason } from '../js/api.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const year = Number(process.env.SEASON || process.argv[2]) || new Date().getFullYear();

// Keep only the fields the model actually reads (see js/stats.js): driver id,
// finishing position and status. Drops Time / FastestLap / Constructors / grid /
// laps / driver bio, which is ~85% of the payload.
const slimRow = (r) => ({
  position: r.position,
  positionText: r.positionText,
  status: r.status,
  Driver: { driverId: r.Driver.driverId },
});
const slimByRound = (byRound) =>
  Object.fromEntries(Object.entries(byRound).map(([rnd, rows]) => [rnd, rows.map(slimRow)]));

const season = await loadSeason(year);
season.results = slimByRound(season.results);
season.sprints = slimByRound(season.sprints);
season.fetchedAt = new Date().toISOString();

const dir = join(root, 'data');
mkdirSync(dir, { recursive: true });
const out = join(dir, `${year}.json`);
writeFileSync(out, JSON.stringify(season));

const top = season.standings.standings.slice(0, 3)
  .map((s) => `${s.name} ${s.points}`).join(', ');
console.log(`Wrote ${out} | ${year} round ${season.standings.round} | top: ${top}`);
