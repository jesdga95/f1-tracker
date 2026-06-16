# Who Wins the Title?

A live Formula 1 championship forecaster. It pulls the real current standings and
race results, derives a model straight from the data, and runs a Monte Carlo
simulation of the rest of the season in your browser to estimate each contender's
title odds.

It started life as a meme about Lewis Hamilton's odds of an 8th title, then turned
into an actual (if hobbyist) forecasting toy. Not monetized, not serious, just out
there for fun.

<img width="800" height="600" alt="f1-tracker-peach vercel app_" src="https://github.com/user-attachments/assets/1c792cde-5a8d-4996-b636-32fd1ceb155d" />

### Live deployment: [Link](https://f1-tracker-peach.vercel.app)

## What it does

- Pulls live driver standings, race results, sprints and the calendar from the
  [Jolpica F1 API](https://github.com/jolpica/jolpica-f1), the open,
  Ergast-compatible successor.
- Derives every model parameter from real data: pace, reliability (DNF rate),
  consistency and the outsider-win rate. No hand-set numbers.
- Regularizes small-sample noise with shrinkage toward sensible priors, so a
  driver who has not retired in 7 races is not treated as a 0% DNF car.
- Simulates the remaining season tens of thousands of times and counts how often
  each driver ends up champion.
- Lets you pick any contender and bend their assumptions (pace, DNF risk,
  development), then watch the odds shift live.
- A "data-driven fidelity" lever slides the whole model from **strict** (trust the
  raw data, a runaway leader stays a near-lock) to **realistic** (adds
  season-to-season uncertainty so the chasers get a real shot).

## Run it locally

Plain static files using ES modules, so serve it over HTTP. Opening the file
directly with `file://` will not load the modules or allow the fetch.

```sh
npx serve
# then open the printed URL (index.html is served at the root)
```

## Deploy

Static site, no build step. On Vercel, import the repo and deploy (or run `vercel`
from the project root). Any static host works: GitHub Pages, Netlify, Cloudflare
Pages. `index.html` is the entry point, so it serves at the root URL.

## How the model works

1. **Real calendar.** Remaining Grands Prix and sprints come from the live
   schedule, so the points still on the table are exact.
2. **Pace as a spread.** Each driver's average finish is an outlier-robust
   (Winsorized) mean of their real classifications, sampled as a noisy position
   every race.
3. **Reliability, regularized.** DNF rates come from real retirements but are
   shrunk toward an 8% prior, so a small clean run does not read as a perfect car.
4. **Development drift.** The one manual knob. Too few races to trust a slope, so
   you set it per driver.
5. **The whole front.** The top contenders are modelled together, and some races
   are stolen by an outsider at a rate also estimated from who has been winning.
6. **Fidelity lever.** A season-level pace offset, `N(0, sigma)`, scaled from 0
   (strict) up to 2.5 (realistic), which is what lets the field breathe.

## Project layout

```
index.html                    structure only (no logic, no data)
styles.css                    all the presentation
js/api.js                     Jolpica client, localStorage cache, snapshot loader
js/stats.js                   derives model params from results (shrinkage, Winsorized pace, ...)
js/sim.js                     the generalized Monte Carlo engine
js/chart.js                   odds-by-round chart with team colors
js/app.js                     boot, rendering, the driver picker and tuning controls
scripts/snapshot.mjs          fetches the season and writes data/<year>.json
.github/workflows/snapshot.yml  cron that refreshes the snapshot and commits it
data/2026.json                committed data snapshot (the app's primary source)
```

## Data freshness and caching

This repo uses a **committed snapshot** as its primary data source:

- A scheduled GitHub Action ([.github/workflows/snapshot.yml](.github/workflows/snapshot.yml))
  runs `scripts/snapshot.mjs` four times a day (every 6 hours). It fetches the
  season from Jolpica, writes [data/2026.json](data), and commits it only if the
  data changed.
- The app loads that file first (`loadSeasonPreferSnapshot` in
  [js/api.js](js/api.js)), so a normal visit makes **zero** calls to the
  third-party API. It loads instantly and keeps working even if Jolpica is down.
- If the snapshot is missing (local dev before the first run), it falls back to a
  live fetch, which is itself cached in `localStorage` for 30 minutes.

GitHub Actions minutes are free and unlimited on public repos, so this costs
nothing. One setup note: in **Settings > Actions > General > Workflow
permissions**, make sure "Read and write permissions" is enabled so the bot can
push the refresh commit. Trigger a first run manually from the Actions tab (the
workflow has a "Run workflow" button), or just commit the seeded `data/2026.json`.

Other options if it ever outgrows this:

- **Vercel serverless caching proxy.** An `api/standings.js` function that fetches
  Jolpica and returns `Cache-Control: s-maxage=900, stale-while-revalidate=3600`,
  so the CDN serves one cached copy to everyone. Good if you want fresher data
  than a cron without per-visitor calls.
- **localStorage TTL only.** Drop the snapshot and rely purely on the per-browser
  cache already in `js/api.js`. Simplest, but every new visitor still makes the
  first call.

## Data and credits

Data from the [Jolpica F1 API](https://github.com/jolpica/jolpica-f1), the
community successor to Ergast. Thanks to that project. F1, Formula 1 and related
marks belong to Formula One Licensing BV; this is an unofficial fan project with no
affiliation.

## Disclaimer

A hobbyist model built on regularized small-sample estimates and one manual
assumption (development). It ignores qualifying pace, track-specific strengths,
weather and live betting markets. This is not betting advice. Treat the number as a
ballpark, not gospel.

## License

MIT. See [LICENSE](LICENSE).
