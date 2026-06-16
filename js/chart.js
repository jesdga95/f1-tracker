// Title-odds-by-round chart. Past rounds are real (each point is a re-sim from
// that round's actual standings, computed in app.js); the dashed tail is a light
// projection forward from today's odds. A wayback season skips the projection
// and instead drops a movable marker on the round the user is inspecting.

import { devToDrift } from './sim.js';

// Keys match Jolpica's constructor `name` exactly. [dark, bright] gradient stops,
// from the 2026 grid liveries.
const TEAM_COLORS = {
  Mercedes: ['#0a4f47', '#00d7b6'],
  Ferrari: ['#9a0000', '#ed1131'],
  McLaren: ['#b8500f', '#f47600'],
  'Red Bull': ['#0a1a52', '#4781d7'],
  Williams: ['#0a2a6b', '#1868db'],
  'Aston Martin': ['#0f5040', '#229971'],
  'Alpine F1 Team': ['#0a5a9a', '#00a1e8'],
  'RB F1 Team': ['#2a3a8a', '#6c98ff'],
  Audi: ['#2a2a2e', '#e1051f'],
  'Cadillac F1 Team': ['#101012', '#e6e7ea'],
  'Haas F1 Team': ['#5a5d61', '#b8bcc0'],
  // Historical names that still front the wayback grid (2020-).
  'Racing Point': ['#9b3a63', '#f596c8'],
  Renault: ['#b59a00', '#ffd60a'],
};
const FALLBACK = ['#3a3f46', '#7d828a'];

export const teamGradient = (team) => TEAM_COLORS[team] || FALLBACK;
export const teamColor = (team) => teamGradient(team)[1];

// Teammates share a team colour, so distinguish them by line style. The index
// within the team (0 = higher in the standings) picks a dash pattern; the legend
// mirrors it via legendSwatch so the key matches the chart.
const DASHES = [null, '11 7', '3 6'];
export function lineStyles(contenders) {
  const seen = {};
  const out = {};
  for (const d of contenders) {
    const idx = (seen[d.team] = (seen[d.team] ?? -1) + 1);
    out[d.id] = { idx, dash: DASHES[Math.min(idx, DASHES.length - 1)] };
  }
  return out;
}
export function legendSwatch(color, idx) {
  if (!idx) return color;                                              // solid bar
  if (idx === 1) return `repeating-linear-gradient(90deg,${color} 0 7px,transparent 7px 12px)`;
  return `repeating-linear-gradient(90deg,${color} 0 2px,transparent 2px 6px)`;
}

// Geometry, shared by every draw/overlay so they stay aligned. yMax sets the
// vertical scale: 100 for the probability chart, the season's points for wayback.
const GEO = { W: 720, H: 300, padL: 8, padR: 8, padT: 12, padB: 12 };
const scales = (meta, yMax = 100) => {
  const { W, H, padL, padR, padT, padB } = GEO;
  return {
    x: (i) => padL + (W - padL - padR) * (i / (meta.totalRounds - 1)),
    y: (v) => padT + (H - padT - padB) * (1 - v / yMax),
  };
};


const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Heuristic projection: a driver faster than the field median and developing
// well gains a little each round, tapering off, renormalized to 100%.
function projectForward(headline, contenders, future) {
  if (future <= 0) return {};
  const medPace = median(contenders.map((d) => d.pace));
  const cur = {};
  for (const d of contenders) cur[d.id] = headline[d.id] ?? 0;
  const out = Object.fromEntries(contenders.map((d) => [d.id, []]));

  for (let k = 1; k <= future; k++) {
    const taper = 1 - (k / future) * 0.5;
    for (const d of contenders) {
      const mom = (medPace - d.pace) * 0.8 - devToDrift(d.dev) * 30;
      cur[d.id] = Math.max(0.2, cur[d.id] + mom * 0.15 * taper);
    }
    const tot = contenders.reduce((s, d) => s + cur[d.id], 0) || 1;
    for (const d of contenders) out[d.id].push((cur[d.id] / tot) * 100);
  }
  return out;
}

// model: { contenders, history: {round -> {id -> odds}}, headline: {id -> odds}, meta }
export function drawChart(svg, { contenders, history, headline, meta }) {
  if (!svg) return;
  const { W, H, padL, padR, padT, padB } = GEO;
  const { round: now, totalRounds: N } = meta;
  const { x, y } = scales(meta);
  const styles = lineStyles(contenders);

  const future = projectForward(headline, contenders, N - now);

  let inner = '<defs>';
  for (const d of contenders) {
    const [a, b] = teamGradient(d.team);
    inner += `<linearGradient id="g_${d.id}" x1="0" x2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
  }
  inner += '</defs>';

  for (const v of [25, 50, 75]) {
    inner += `<line class="grid" x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}"/>`;
    inner += `<text class="axlabel" x="${padL + 2}" y="${y(v) - 4}">${v}%</text>`;
  }

  // The "now" divider only makes sense mid-season; a completed season has no tail.
  if (now < N) {
    const nowX = x(now - 1);
    inner += `<line class="nowline" x1="${nowX}" y1="${padT}" x2="${nowX}" y2="${H - padB}"/>`;
  }

  // Draw lower-odds drivers first so the favourites sit on top.
  const ordered = [...contenders].sort(
    (a, b) => (headline[a.id] ?? 0) - (headline[b.id] ?? 0)
  );

  for (const d of ordered) {
    const stroke = `url(#g_${d.id})`;
    const { dash } = styles[d.id];

    const pastPts = [];
    for (let r = 1; r <= now; r++) {
      const v = r === now ? headline[d.id] : history[r]?.[d.id];
      if (v == null) continue;
      pastPts.push([x(r - 1), y(v)]);
    }
    if (pastPts.length) {
      const path = pastPts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
      // A dashed teammate line can't share the draw-in animation (it hijacks
      // stroke-dasharray), so it renders styled-but-static via the `alt` class.
      const cls = dash ? 'line alt' : 'line';
      const dashAttr = dash ? ` style="stroke-dasharray:${dash}"` : '';
      inner += `<path class="${cls}" d="${path}" stroke="${stroke}"${dashAttr}/>`;
    }

    const fut = future[d.id] || [];
    if (fut.length) {
      const futPts = [[x(now - 1), y(headline[d.id] ?? 0)]];
      fut.forEach((v, k) => futPts.push([x(now - 1 + (k + 1)), y(v)]));
      const path = futPts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
      inner += `<path class="line proj" d="${path}" stroke="${stroke}"/>`;
      const [ex, ey] = futPts[futPts.length - 1];
      inner += `<circle class="dot" cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="4.5" fill="${stroke}"/>`;
    } else {
      const [ex, ey] = pastPts[pastPts.length - 1] || [];
      if (ex != null) inner += `<circle class="dot" cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="4.5" fill="${stroke}"/>`;
    }
  }

  // Empty layer the scrubber writes into, so moving the marker never re-runs
  // (and re-animates) the lines.
  inner += '<g class="markwrap"></g>';

  svg.innerHTML = inner;
}

// Scrubber overlay: a vertical line at `round` plus a dot on each driver's curve
// there. Updates only the marker layer, leaving the drawn lines untouched.
// series = { round -> {id -> value} } on the same scale as the chart (yMax).
export function drawMarker(svg, { contenders, series, meta, round, yMax = 100 }) {
  if (!svg) return;
  const wrap = svg.querySelector('.markwrap');
  if (!wrap || !round) return;
  const { padT, H, padB } = GEO;
  const { x, y } = scales(meta, yMax);
  const r = Math.min(round, meta.totalRounds);
  const mx = x(r - 1);

  let m = `<line class="markline" x1="${mx.toFixed(1)}" y1="${padT}" x2="${mx.toFixed(1)}" y2="${H - padB}"/>`;
  for (const d of contenders) {
    const v = series[r]?.[d.id] ?? 0;
    m += `<circle class="markdot" cx="${mx.toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="url(#g_${d.id})"/>`;
  }
  wrap.innerHTML = m;
}
