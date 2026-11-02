// Mathematical title clinch: once no rival can reach the leader's total even by
// winning everything left, the championship is decided, whatever any model says.

// Most points one driver can still score per Grand Prix / sprint in a season.
// 2019-2024 awarded +1 for fastest lap (top-10 finishers); 2021 sprints paid
// 3-2-1, every later sprint 8 down to 1.
export function maxPerRound(year) {
  return {
    gp: year >= 2019 && year <= 2024 ? 26 : 25,
    sprint: year === 2021 ? 3 : 8,
  };
}

// Points still on the table after `round` of the season described by meta
// ({ year, totalRounds, sprintRounds }).
export function pointsLeft(meta, round) {
  const { gp, sprint } = maxPerRound(meta.year);
  const gpLeft = Math.max(0, meta.totalRounds - round);
  const sprintsLeft = (meta.sprintRounds || []).filter((sr) => sr > round).length;
  return { gpLeft, max: gpLeft * gp + sprintsLeft * sprint };
}

// Returns the champion's id if the title is mathematically settled after
// `round`, else null. points: { id -> points } for the WHOLE grid (not just the
// modelled contenders). wins (optional): { id -> wins } to settle the exact-tie
// edge case on countback.
export function clinchedChampion(points, meta, round, wins) {
  const ranked = Object.entries(points).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  const [leaderId, leaderPts] = ranked[0];
  if (ranked.length === 1) return leaderId;
  const [rivalId, rivalPts] = ranked[1];
  const gap = leaderPts - rivalPts;
  const { gpLeft, max } = pointsLeft(meta, round);

  if (gap > max) return leaderId;
  // A rival can only draw level by winning every remaining GP, so the leader
  // keeps it on countback if they already hold more wins than that.
  if (gap === max && gap > 0 && wins
      && (wins[leaderId] ?? 0) > (wins[rivalId] ?? 0) + gpLeft) return leaderId;
  return null;
}

// Odds map for a settled title: 100 for the champion, 0 for everyone else.
export const settledOdds = (ids, champ) =>
  Object.fromEntries(ids.map((id) => [id, id === champ ? 100 : 0]));
