// Pure calculation functions — no side effects, easy to reason about and test.

/** Sum of headcounts across every payment group in a session. */
export function totalHeadcount(groups) {
  return (groups || []).reduce((n, g) => n + (Number(g.headcount) || 0), 0)
}

/**
 * Resolve the per-person court + shuttle rates for a session.
 * Both can be derived from session-level totals divided by the number of players.
 *
 * @param {Object} session - {
 *   court_fee_mode: 'per_person' | 'split',
 *   court_fee_per_slot,   // used when mode === 'per_person'
 *   court_fee_total,      // used when mode === 'split'
 *   shuttle_count,        // shuttles used this session
 *   shuttle_price_each,   // price per shuttle
 * }
 * @param {number} headTotal - sum of all headcounts in the session
 */
export function resolveRates(session, headTotal) {
  const players = Number(headTotal) > 0 ? Number(headTotal) : 0
  const divisor = players || 1 // avoid divide-by-zero; rates read as 0 anyway when there's no total

  const shuttleTotalCost =
    (Number(session.shuttle_count) || 0) * (Number(session.shuttle_price_each) || 0)
  const shuttleUnitCost = players ? shuttleTotalCost / divisor : 0

  const courtFeeTotal = Number(session.court_fee_total) || 0
  const courtUnitCost =
    session.court_fee_mode === 'split'
      ? players
        ? courtFeeTotal / divisor
        : 0
      : Number(session.court_fee_per_slot) || 0

  return { players, shuttleTotalCost, shuttleUnitCost, courtFeeTotal, courtUnitCost }
}

/**
 * @param {Object} session - see resolveRates
 * @param {Object} group - { payer_status_snapshot, headcount, water_cost, penalty }
 * @param {number} [headTotal] - sum of all headcounts in the session; defaults to this group's own headcount
 */
export function calcGroup(session, group, headTotal) {
  const headcount = Number(group.headcount) || 1
  const water = Number(group.water_cost) || 0
  const penalty = Number(group.penalty) || 0

  const { shuttleUnitCost, courtUnitCost } = resolveRates(
    session,
    headTotal == null ? headcount : headTotal
  )

  const courtTotal = courtUnitCost * headcount
  const shuttleTotal = shuttleUnitCost * headcount
  const actualCost = courtTotal + shuttleTotal + water

  const isGuest = group.payer_status_snapshot === 'guest'
  const amountToPay = isGuest
    ? session.guest_fixed_rate * headcount + penalty
    : actualCost + penalty

  const fundsGenerated = isGuest
    ? session.guest_fixed_rate * headcount - actualCost
    : 0

  return {
    courtUnitCost,
    shuttleUnitCost,
    courtTotal,
    shuttleTotal,
    water,
    penalty,
    actualCost,
    amountToPay,
    fundsGenerated,
  }
}

export function calcSessionTotals(session, groups) {
  const headTotal = totalHeadcount(groups)
  return (groups || []).reduce(
    (acc, g) => {
      const r = calcGroup(session, g, headTotal)
      acc.totalCollected += r.amountToPay
      acc.totalFunds += r.fundsGenerated
      return acc
    },
    { totalCollected: 0, totalFunds: 0 }
  )
}

export const money = (n) =>
  Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
