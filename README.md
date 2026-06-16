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

- Uses real driver standings, race results, sprints and the calendar from the
  [Jolpica F1 API](https://github.com/jolpica/jolpica-f1) (the open,
  Ergast-compatible successor), refreshed a few times a day.
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
index.html                      structure only (no logic, no data)
styles.css                      all the presentation
js/api.js                       Jolpica client (build-time) + snapshot loader (browser)
js/stats.js                     derives model params from results (shrinkage, Winsorized pace, ...)
js/sim.js                       the generalized Monte Carlo engine
js/chart.js                     odds-by-round chart with team colors
js/app.js                       boot, rendering, the driver picker and tuning controls
scripts/snapshot.mjs            builds data/latest.json from the live API
.github/workflows/snapshot.yml  cron that refreshes the snapshot and commits it
data/latest.json                committed snapshot the site reads
```

## Data and refresh

The browser never calls the F1 API. It reads a committed snapshot,
`data/latest.json`, so every visit is instant and a third-party outage or a
traffic spike cannot break the page. A returning visitor is covered even offline:
the last snapshot is also cached in `localStorage`.

A scheduled GitHub Action ([.github/workflows/snapshot.yml](.github/workflows/snapshot.yml))
runs `scripts/snapshot.mjs` every 6 hours. It fetches the current season from
Jolpica, strips each result to the few fields the model uses, and rewrites
`data/latest.json` only when the standings actually changed. If a fetch fails it
exits without writing, so the last good snapshot stays in place. It always
snapshots the most recent season that has standings, so it rolls into the next
year on its own with no off-season gap.

Setup: in **Settings > Actions > General > Workflow permissions**, enable "Read
and write permissions" so the bot can push the refresh commit.

## Data and credits

Data from the [Jolpica F1 API](https://github.com/jolpica/jolpica-f1), the
community successor to Ergast. Thanks to that project. F1, Formula 1 and related
marks belong to Formula One Licensing BV; this is an unofficial fan project with no
affiliation.

## Disclaimer

For entertainment only. This is not betting, gambling, investment, or financial
advice. Who Wins the Title? is an unofficial, non-commercial fan project, not
affiliated with or endorsed by Formula 1, the FIA, Formula One Management, or any
team, driver, or sponsor. F1 and related marks belong to their respective owners.

The percentages are the output of a simplified statistical toy, not predictions,
odds, or facts, and they are frequently wrong. The underlying data may be
inaccurate, incomplete, or out of date. Do not use this site for any wager or
decision. It is provided "as is", without warranty of any kind; to the maximum
extent permitted by law, the author accepts no liability for any loss or damage
arising from its use. You use it entirely at your own risk.

## License

MIT. See [LICENSE](LICENSE).
