# Who Wins the Title?

A live Formula 1 championship forecaster. It pulls the real current standings,
derives a model from the data, and runs a Monte Carlo simulation of the rest of
the season in your browser to estimate each contender's title odds.

Started as a meme about Hamilton's odds of an 8th title, now an actual (if
hobbyist) forecasting toy. Just out there for fun.

<img width="800" height="600" alt="Who Wins the Title?" src="https://github.com/user-attachments/assets/1c792cde-5a8d-4996-b636-32fd1ceb155d" />

### Live: [f1-tracker-peach.vercel.app](https://f1-tracker-peach.vercel.app)

## What it does

- Pulls real standings, results, sprints and the calendar from the
  [Jolpica F1 API](https://github.com/jolpica/jolpica-f1) (the open,
  Ergast-compatible successor).
- Derives every model parameter from data: pace, reliability, consistency and
  the outsider-win rate, with shrinkage toward sensible priors so small samples
  do not dominate.
- Charts title odds round by round, with a marker for where the real season
  stands now.
- **Wayback machine:** replay any season from 2020 on. Drag through every race
  and watch the odds evolve from the grid as they stood at that point, with no
  hindsight.
- **Run your own season:** tune any contender's pace, DNF risk and development
  and watch the live Monte Carlo shift.
- A fidelity lever slides the model from **strict** (trust the raw data) to
  **realistic** (adds season-to-season uncertainty so the chasers get a shot).

## How it forecasts

Two complementary engines:

- **Analytic odds** ([js/odds.js](js/odds.js)) drive the season-long chart and
  wayback replay. For each round, a driver's remaining points are a normal
  distribution around their pace so far (an expanding window, no future
  knowledge), and the title probability is the analytic chance their final total
  beats every rival's, by numerical integration. So a runaway leader still
  concedes a real early chance and only firms to a lock as the rounds run out.
- **Monte Carlo** ([js/sim.js](js/sim.js)) powers the interactive tuner. It
  simulates the remaining season tens of thousands of times, sampling a noisy
  result for each contender every race, then counts how often each ends up
  champion.

## Run it locally

Plain static files using ES modules, so serve over HTTP (opening `file://` will
not load the modules):

```sh
npx serve
```

No build step. Any static host works (Vercel, GitHub Pages, Netlify);
`index.html` is the entry point.

## Data

The browser never calls the F1 API. A GitHub Action runs
[scripts/snapshot.mjs](scripts/snapshot.mjs) every 6 hours and commits one
`data/{year}.json` per season plus a `data/seasons.json` manifest. The live
season is refreshed every run (only when standings change); past seasons are
fetched once to capture their official per-round standings, then frozen. The
site reads those committed snapshots, so every visit is instant and a
third-party outage cannot break the page.

To run the refresh yourself, enable "Read and write permissions" under
**Settings > Actions > General > Workflow permissions**.

## Disclaimer

For entertainment only. Not betting, gambling, or financial advice. This is an
unofficial, non-commercial fan project, not affiliated with or endorsed by
Formula 1, the FIA, FOM, or any team. F1 and related marks belong to their
respective owners. The percentages are the output of a simplified statistical
toy and are frequently wrong. Provided "as is", without warranty; use at your
own risk.

## License

MIT. See [LICENSE](LICENSE).
</content>
