// Boot, render, and wire the driver picker + per-driver tuning sliders. Data
// comes from the committed snapshot only (see js/api.js).

import { loadSnapshot } from './api.js';
import { deriveParams } from './stats.js';
import { simulate, simulateChunked } from './sim.js';
import { drawChart, teamColor } from './chart.js';

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
  season: null,
  year: null,
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

function renderBars(odds) {
  const { contenders } = state.model;
  const sorted = [...contenders].sort((a, b) => (odds[b.id] ?? 0) - (odds[a.id] ?? 0));
  const max = Math.max(1, ...sorted.map((d) => odds[d.id] ?? 0));
  const leaderPts = Math.max(...contenders.map((d) => d.points));
  $('bars').innerHTML = sorted.map((d) => {
    const pct = odds[d.id] ?? 0;
    const gap = d.points - leaderPts;
    const tag = gap === 0 ? 'LEADER' : `${gap} PTS`;
    return `
      <div class="driver">
        <div class="drow">
          <div><span class="dname">${d.name}</span><span class="dteam">${d.team.toUpperCase()} · ${tag}</span></div>
          <div class="dpct">${pct.toFixed(1)}%</div>
        </div>
        <div class="track"><div class="bar" style="width:${(pct / max) * 100}%;background:linear-gradient(90deg,${teamColor(d.team)}88,${teamColor(d.team)})"></div></div>
      </div>`;
  }).join('');
}

function renderLegend() {
  $('legend').innerHTML = state.model.contenders.map((d) =>
    `<span class="lg"><i style="background:${teamColor(d.team)}"></i>${d.name}</span>`
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
  setBusy(true, `Simulating ${state.runs.toLocaleString()} seasons…`);
  simulateChunked(state.model.contenders, nowSchedule(), state.runs, seed, {
    onProgress: (f) => { $('progBar').style.width = `${f * 100}%`; },
    onDone: (odds) => {
      renderAll(odds);
      setBusy(false, `${label} · ${state.runs.toLocaleString()} seasons`);
      setTimeout(() => $('progWrap').classList.remove('on'), 250);
    },
  });
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
    state.season = await loadSnapshot();
    state.year = state.season.year;
    state.model = deriveParams(state.season);
    state.history = computeHistory(state.model);
    state.selectedId = state.model.contenders[0].id;

    showDataSource(state.season.fetchedAt);
    renderLegend();
    renderPicker();
    buildControls();
    run('Baseline', BASE_SEED);
  } catch (err) {
    console.error(err);
    $('heroNum').textContent = '··';
    $('heroClaim').textContent = 'Data is not available yet.';
    $('heroSub').textContent = 'Could not load the data snapshot. If this is a fresh deploy, the scheduled job may not have produced data/latest.json yet.';
    $('runState').textContent = 'No data';
    $('resetBtn').disabled = true;
  }
}

boot();
