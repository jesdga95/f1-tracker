// Boot, render, and wire the driver picker + per-driver tuning sliders. Data
// comes from the committed snapshot only (see js/api.js).

import { loadManifest, loadSeasonSnapshot } from './api.js';
import { deriveParams } from './stats.js';
import { simulate, simulateChunked } from './sim.js';
import { drawChart, drawMarker, teamColor, lineStyles, legendSwatch } from './chart.js';
import { titleOddsByRound } from './odds.js';

const BASE_RUNS = 50_000;
const HISTORY_RUNS = 4_000;
const BASE_SEED = 12345;
const DEV_LABELS = ['none', 'slow', 'steady', 'strong', 'rapid', 'runaway'];
const HAMILTON = 'hamilton';

// Fidelity lever: realism 0..1 maps to the season pace sigma fed to the sim.
// 0 = strict (data as-is, a runaway leader stays a near-lock); 1 = realistic.
const SIGMA_MAX = 2.5;
const DEFAULT_REALISM = 0.5;
const FIDELITY_LABELS = ['strict', 'firm', 'balanced', 'loose', 'realistic'];

const $ = (id) => document.getElementById(id);
const kkMultiplier = (step) => 1 + step * 0.15;

const state = {
  manifest: null,      // { current, years } from data/seasons.json
  liveYear: null,      // the one tunable season
  seasons: {},         // year -> raw snapshot cache
  season: null,        // raw snapshot for the displayed year
  year: null,          // displayed year
  tunable: false,      // is the displayed season the live one (toggles on)?
  gen: 0,              // bumped on each season switch / run to drop stale sims
  model: null,
  history: {},
  selectedId: null,
  latestOdds: {},
  runs: BASE_RUNS,
  realism: DEFAULT_REALISM,
  tuned: false,
};

const seasonSigma = () => state.realism * SIGMA_MAX;

// KK easter egg: post-multiply Hamilton's share, renormalize to 100%.
function displayOdds(raw) {
  const ham = state.model.contenders.find((d) => d.id === HAMILTON);
  const kk = ham ? kkMultiplier(ham.kk || 0) : 1;
  if (kk === 1 || raw[HAMILTON] == null) return { ...raw };
  const out = { ...raw, [HAMILTON]: raw[HAMILTON] * kk };
  const tot = Object.values(out).reduce((a, b) => a + b, 0) || 1;
  for (const k of Object.keys(out)) out[k] = (out[k] / tot) * 100;
  return out;
}

// Re-sim each past round from its actual standings to get the historical lines.
function computeHistory(model) {
  const { meta, contenders } = model;
  const history = {};
  for (let r = 1; r < meta.round; r++) {
    const pts = model.pointsByRound[r] || {};
    const field = contenders.map((d) => ({ ...d, points: pts[d.id] ?? 0 }));
    const schedule = {
      nGP: meta.totalRounds - r,
      rivalWin: model.rivalWin,
      seasonSigma: seasonSigma(),
      sprintOffsets: meta.sprintRounds.filter((sr) => sr > r).map((sr) => sr - r - 1),
    };
    history[r] = simulate(field, schedule, HISTORY_RUNS, 1000 + r);
  }
  return history;
}

function nowSchedule() {
  const { meta } = state.model;
  return {
    nGP: meta.gpLeft,
    rivalWin: state.model.rivalWin,
    sprintOffsets: meta.sprintOffsets,
    seasonSigma: seasonSigma(),
  };
}

// Wayback hero: the REAL championship standings after a chosen round — points
// only, no probability (the chart and bars carry the odds). pts = points that round.
function renderHeroWayback(pts, round) {
  const { contenders, meta } = state.model;
  const N = meta.totalRounds;
  const ranked = [...contenders].sort((a, b) => (pts[b.id] ?? 0) - (pts[a.id] ?? 0));
  const leader = ranked[0];
  const second = ranked[1];
  $('heroNum').innerHTML = `${pts[leader.id] ?? 0}<span class="pct">PTS</span>`;

  if (round >= N) {
    const champ = contenders[0];                 // standings are championship-ordered (countback-safe)
    const margin = second ? (pts[champ.id] ?? 0) - (pts[second.id] ?? 0) : 0;
    $('heroClaim').textContent = `${champ.name} won the ${state.year} World Championship.`;
    $('heroSub').textContent = second
      ? `Final standings after ${N} rounds: ${champ.name} on ${pts[champ.id] ?? 0} pts, ${margin} clear of ${second.name}. `
        + `Drag the race slider to replay how the odds swung.`
      : `Final standings after ${N} rounds: ${champ.name} on ${pts[champ.id] ?? 0} pts.`;
  } else {
    const left = N - round;
    const gap = second ? (pts[leader.id] ?? 0) - (pts[second.id] ?? 0) : 0;
    $('heroClaim').textContent = `${leader.name} leads the ${state.year} championship after Round ${round}.`;
    $('heroSub').textContent = `Real standings after Round ${round}, with ${left} race${left === 1 ? '' : 's'} still to run. `
      + (second ? `${gap} pts clear of ${second.name}. ` : '')
      + `Drag the slider to move through the season; the bars show each driver's title chance.`;
  }
  $('hero').dataset.bg = leader.num || '';
}

function renderHero(odds) {
  const { contenders, meta } = state.model;
  const fav = contenders.reduce((a, b) => ((odds[b.id] ?? 0) > (odds[a.id] ?? 0) ? b : a));
  const leader = contenders.reduce((a, b) => (b.points > a.points ? b : a));
  $('heroNum').innerHTML = `${(odds[fav.id] ?? 0).toFixed(1)}<span class="pct">%</span>`;
  $('heroClaim').textContent = `${fav.name} is the most likely ${state.year} World Champion.`;

  const sprints = `${meta.sprintsLeft} sprint${meta.sprintsLeft === 1 ? '' : 's'}`;
  const standings = `${leader.name} leads on ${leader.points} pts after Round ${meta.round}, `
    + `with ${meta.gpLeft} Grands Prix and ${sprints} still to run.`;
  $('heroSub').textContent = state.tuned
    ? `Your tuned scenario at ${FIDELITY_LABELS[Math.round(state.realism * 4)]} fidelity. ${standings}`
    : `A Monte Carlo estimate from real classification. ${standings} Pick a driver below and bend the assumptions.`;
  $('hero').dataset.bg = fav.num || '';
}

// pointsMap is optional: in wayback, pass the real standings as of the chosen
// round so the gap tags reflect that moment and the actual points sit beside the
// title chance; omit it for the live season (chance only).
function renderBars(odds, pointsMap) {
  const { contenders } = state.model;
  const ptsOf = (d) => (pointsMap ? (pointsMap[d.id] ?? 0) : d.points);
  const sorted = [...contenders].sort((a, b) => (odds[b.id] ?? 0) - (odds[a.id] ?? 0));
  const max = Math.max(1, ...sorted.map((d) => odds[d.id] ?? 0));
  const leaderPts = Math.max(...contenders.map(ptsOf));
  $('bars').innerHTML = sorted.map((d) => {
    const pct = odds[d.id] ?? 0;
    const gap = ptsOf(d) - leaderPts;
    const tag = gap === 0 ? 'LEADER' : `${gap} PTS`;
    const points = pointsMap ? `<span class="dpts">${ptsOf(d)} pts</span>` : '';
    return `
      <div class="driver">
        <div class="drow">
          <div><span class="dname">${d.name}</span><span class="dteam">${d.team.toUpperCase()} · ${tag}</span></div>
          <div class="dpct">${points}${pct.toFixed(1)}%</div>
        </div>
        <div class="track"><div class="bar" style="width:${(pct / max) * 100}%;background:linear-gradient(90deg,${teamColor(d.team)}88,${teamColor(d.team)})"></div></div>
      </div>`;
  }).join('');
}

function renderLegend() {
  const styles = lineStyles(state.model.contenders);
  $('legend').innerHTML = state.model.contenders.map((d) =>
    `<span class="lg"><i style="background:${legendSwatch(teamColor(d.team), styles[d.id].idx)}"></i>${d.name}</span>`
  ).join('');
}

function renderChart(odds) {
  $('xlast').textContent = `R${state.model.meta.totalRounds}`;
  drawChart($('chart'), {
    contenders: state.model.contenders,
    history: state.history,
    headline: odds,
    meta: state.model.meta,
  });
}

function renderAll(rawOdds) {
  state.latestOdds = rawOdds;
  const odds = displayOdds(rawOdds);
  renderHero(odds);
  renderBars(odds);
  renderChart(odds);
  $('stampN').textContent = state.runs.toLocaleString();
}

function showDataSource(fetchedAt) {
  const el = $('dataSrc');
  if (!el) return;
  if (!state.tunable) { el.textContent = `${state.year} FINAL · JOLPICA F1`; return; }
  const when = fetchedAt
    ? new Date(fetchedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase()
    : null;
  el.textContent = when ? `DATA AS OF ${when} · JOLPICA F1` : 'DATA VIA JOLPICA F1';
}

function renderPicker() {
  $('picker').innerHTML = state.model.contenders.map((d) =>
    `<button class="chip" data-id="${d.id}" aria-pressed="${d.id === state.selectedId}">
       <span class="swatch" style="background:${teamColor(d.team)}"></span>${d.name}
       <span class="num">#${d.num}</span>
     </button>`
  ).join('');
  $('picker').querySelectorAll('.chip').forEach((btn) =>
    btn.addEventListener('click', () => selectDriver(btn.dataset.id)));
}

function selectDriver(id) {
  state.selectedId = id;
  $('picker').querySelectorAll('.chip').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.id === id)));
  buildControls();
}

function control({ id, label, value, min, max, step, hint, hidden, wide }) {
  return `
    <div class="ctrl${wide ? ' wide' : ''}${hidden ? ' hidden' : ''}">
      <label>${label} <span id="v_${id}"></span></label>
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}">
      <div class="hint">${hint}</div>
    </div>`;
}

function buildControls() {
  const d = state.model.contenders.find((c) => c.id === state.selectedId);
  $('tuningName').innerHTML = `Tuning <b>${d.name}</b> · ${d.team}`;

  $('controls').innerHTML = [
    control({ id: 'pace', label: 'Pace (avg finish)', value: d.pace, min: 1, max: 6, step: 0.1,
      hint: 'Average finishing position when classified. Lower = faster.' }),
    control({ id: 'dnf', label: 'DNF risk', value: Math.round(d.dnf * 100), min: 0, max: 25, step: 1,
      hint: 'Chance of failing to finish each race. Derived from real retirements, shrunk toward an 8% prior.' }),
    control({ id: 'dev', label: 'Development', value: d.dev, min: 0, max: 5, step: 1,
      hint: 'How the car trends over the back half. Manual: too few races to trust a slope.' }),
    control({ id: 'kk', label: 'The Kim K effect', value: d.kk || 0, min: 0, max: 10, step: 1,
      hint: "Slide for the power of love 💋",
      hidden: d.id !== HAMILTON }),
    control({ id: 'fidelity', label: 'Data-driven fidelity', value: state.realism * 100,
      min: 0, max: 100, step: 25, wide: true,
      hint: 'Strict trusts the raw data, so a runaway leader stays a near-lock. Realistic adds season-to-season uncertainty so the chasers get a real shot.' }),
    `<div class="ctrl wide">
       <label>Seasons to simulate <span id="v_runs"></span></label>
       <input type="range" id="runs" min="10000" max="100000" step="10000" value="${state.runs}">
       <div class="hint">More seasons = a steadier number, but a longer run.</div>
     </div>`,
  ].join('');

  bindControls(d);
  syncLabels(d);
}

function syncLabels(d) {
  $('v_pace').textContent = Number($('pace').value).toFixed(1);
  $('v_dnf').textContent = `${$('dnf').value}%`;
  $('v_dev').textContent = DEV_LABELS[Number($('dev').value)];
  $('v_runs').textContent = Number($('runs').value).toLocaleString();
  $('v_fidelity').textContent = FIDELITY_LABELS[Number($('fidelity').value) / 25];
  if ($('kk')) $('v_kk').textContent = `${kkMultiplier(Number($('kk').value)).toFixed(1)}×`;
}

function bindControls(d) {
  const pace = $('pace'), dnf = $('dnf'), dev = $('dev'), kk = $('kk'), runs = $('runs'), fidelity = $('fidelity');
  [pace, dnf, dev, kk, runs, fidelity].filter(Boolean).forEach((el) =>
    el.addEventListener('input', () => syncLabels(d)));

  // KK only re-renders; it never changes the simulation.
  kk?.addEventListener('input', () => { d.kk = Number(kk.value); state.tuned = true; renderAll(state.latestOdds); });

  const apply = () => {
    d.pace = Number(pace.value);
    d.dnf = Number(dnf.value) / 100;
    d.dev = Number(dev.value);
    state.tuned = true;
    run(`Your assumptions for ${d.name}`);
  };
  [pace, dnf, dev].forEach((el) => el.addEventListener('change', apply));
  runs.addEventListener('change', () => {
    state.runs = Number(runs.value);
    run(state.tuned ? `Your assumptions for ${d.name}` : 'Baseline');
  });

  // Fidelity is global and changes the season model, so history is recomputed.
  fidelity.addEventListener('change', () => {
    state.realism = Number(fidelity.value) / 100;
    state.tuned = true;
    state.history = computeHistory(state.model);
    run(`${FIDELITY_LABELS[Number(fidelity.value) / 25]} model`);
  });
}

function setBusy(busy, msg) {
  $('resetBtn').disabled = busy;
  if (msg != null) $('runState').textContent = msg;
  $('progWrap').classList.toggle('on', busy);
}

function run(label, seed = (Date.now() & 0xffffff)) {
  const gen = ++state.gen;   // any earlier run/season-switch is now stale
  setBusy(true, `Simulating ${state.runs.toLocaleString()} seasons…`);
  simulateChunked(state.model.contenders, nowSchedule(), state.runs, seed, {
    onProgress: (f) => { if (gen === state.gen) $('progBar').style.width = `${f * 100}%`; },
    onDone: (odds) => {
      if (gen !== state.gen) return;   // a newer run or season took over
      renderAll(odds);
      setBusy(false, `${label} · ${state.runs.toLocaleString()} seasons`);
      setTimeout(() => $('progWrap').classList.remove('on'), 250);
    },
  });
}

const raceLabel = (r, N) => (r >= N ? `Round ${r} of ${N} · final` : `Round ${r} of ${N}`);

// Wayback: compute the analytic title odds for every round from the real
// standings (no Monte Carlo), draw the full probability arc once, then let the
// slider scrub a marker across it. state.waySeries holds the real points (for
// the standings context); state.history holds the per-round odds.
function enterWayback() {
  setBusy(false);
  const { meta, contenders } = state.model;
  const N = meta.totalRounds;
  state.waySeries = state.season.standingsByRound || state.model.pointsByRound;
  state.history = titleOddsByRound(state.waySeries, contenders.map((d) => d.id), meta);
  renderChart(state.history[N]);       // headline = settled finale; lines drawn once

  state.wayRound = 1;                  // open at Round 1 and let the user replay forward
  const slider = $('raceSlider');
  slider.min = 1; slider.max = N; slider.step = 1; slider.value = 1;
  slider.oninput = () => { state.wayRound = Number(slider.value); updateWayback(state.wayRound); };
  updateWayback(state.wayRound);
}

// The title odds + real standings + chart marker as they stood after `round`.
function updateWayback(round) {
  const { meta, contenders } = state.model;
  const N = meta.totalRounds;
  const r = Math.min(round, N);
  const odds = state.history[r] || {};
  const pts = state.waySeries[r] || {};
  renderHeroWayback(pts, r);
  renderBars(odds, pts);
  drawMarker($('chart'), { contenders, series: state.history, meta, round: r, yMax: 100 });
  $('v_race').textContent = raceLabel(r, N);
  $('barsLabel').textContent = r >= N ? `Final championship · after ${N} rounds` : `Title odds after Round ${r}`;
}

function renderSeasonPicker() {
  const years = [...state.manifest.years].sort((a, b) => b - a);   // newest first
  $('seasonPicker').innerHTML = years.map((y) => {
    const tag = y === state.liveYear
      ? '<span class="num live">LIVE</span>'
      : '<span class="num">replay</span>';
    return `<button class="chip" data-year="${y}" aria-pressed="${y === state.year}">${y}${tag}</button>`;
  }).join('');
  $('seasonPicker').querySelectorAll('.chip').forEach((btn) =>
    btn.addEventListener('click', () => selectSeason(Number(btn.dataset.year))));
}

function updateSeasonActive() {
  $('seasonPicker').querySelectorAll('.chip').forEach((b) =>
    b.setAttribute('aria-pressed', String(Number(b.dataset.year) === state.year)));
}

// Toggle UI between the live (simulated, tunable) season and a wayback season
// (real, settled championship data — no Monte Carlo).
function applyMode() {
  state.tunable = state.year === state.liveYear && state.model.meta.gpLeft > 0;
  $('sim').hidden = !state.tunable;            // "Run your own season" is live-only
  $('method').hidden = !state.tunable;         // "What's under the hood" describes the live model
  $('racePick').hidden = state.tunable;        // the race scrubber is wayback-only
  $('bars').classList.toggle('instant', !state.tunable);   // no grow-animation while scrubbing
  $('xnow').style.display = state.tunable ? '' : 'none';
  $('eyebrow').textContent = state.tunable
    ? 'Live Title Race · Monte Carlo'
    : `${state.year} Season · Wayback · Real Results`;
  $('chartLabel').textContent = 'Title odds across the season';
  if (state.tunable) $('barsLabel').textContent = 'Who takes the crown, simulated';
  renderStamp();
}

// The hero stamp: a simulated-seasons count when live; for wayback, odds are
// computed analytically from real results, so say so (no simulation).
function renderStamp() {
  $('stamp').innerHTML = state.tunable
    ? `MODEL STATE · <span class="live" id="stampN">${state.runs.toLocaleString()}</span> SIMULATED SEASONS · <span id="dataSrc"></span>`
    : `REPLAY · ODDS FROM REAL RESULTS · NO SIMULATION · <span id="dataSrc"></span>`;
}

async function selectSeason(year) {
  state.year = year;
  state.gen++;                       // invalidate any in-flight sim from the old season
  updateSeasonActive();
  setBusy(true, 'Loading season…');
  try {
    state.season = state.seasons[year] ??= await loadSeasonSnapshot(year);
  } catch (err) {
    console.error(err);
    $('runState').textContent = 'Could not load that season.';
    setBusy(false);
    return;
  }
  if (state.year !== year) return;   // user switched again while we were loading

  // Each season starts from its own baseline; tuning never carries across.
  state.runs = BASE_RUNS;
  state.realism = DEFAULT_REALISM;
  state.tuned = false;
  state.model = deriveParams(state.season);
  state.selectedId = state.model.contenders[0].id;

  applyMode();                 // sets state.tunable from the model
  showDataSource(state.season.fetchedAt);
  renderLegend();
  if (state.tunable) {
    state.history = computeHistory(state.model);   // Monte Carlo only for the live season
    renderPicker();
    buildControls();
    run('Baseline', BASE_SEED);
  } else {
    enterWayback();                                // analytic odds from real data, no sims
  }
}

function reset() {
  state.model = deriveParams(state.season);
  state.runs = BASE_RUNS;
  state.realism = DEFAULT_REALISM;
  state.tuned = false;
  state.history = computeHistory(state.model);
  renderLegend();
  renderPicker();
  if (!state.model.contenders.some((d) => d.id === state.selectedId)) {
    state.selectedId = state.model.contenders[0].id;
  }
  selectDriver(state.selectedId);
  run('Baseline', BASE_SEED);
}

async function boot() {
  $('resetBtn').addEventListener('click', reset);
  try {
    state.manifest = await loadManifest();
    state.liveYear = state.manifest.current;
    renderSeasonPicker();
    await selectSeason(state.liveYear);
  } catch (err) {
    console.error(err);
    $('heroNum').textContent = '··';
    $('heroClaim').textContent = 'Data is not available yet.';
    $('heroSub').textContent = 'Could not load the data snapshot. If this is a fresh deploy, the scheduled job may not have produced data/seasons.json yet.';
    $('runState').textContent = 'No data';
    $('resetBtn').disabled = true;
  }
}

boot();
