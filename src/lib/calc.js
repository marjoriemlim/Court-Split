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
 * Additional costs are free-form line items ({ label, amount, payment_group_id }).
 * - payment_group_id set   → charged in full to that one payment group
 * - payment_group_id null  → split across everyone by headcount
 *
 * A negative `amount` is a credit: someone who bought the shuttles for the
 * group, or is carrying an overpayment forward. The arithmetic is identical —
 * it just subtracts instead of adds.
 *
 * @param {Array} extras
 * @param {number} headTotal - sum of all headcounts in the session
 */
export function extrasSummary(extras, headTotal) {
  const list = extras || []
  const split = list.filter((e) => !e.payment_group_id)
  const direct = list.filter((e) => e.payment_group_id)
  const splitTotal = split.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const directTotal = direct.reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const players = Number(headTotal) > 0 ? Number(headTotal) : 0
  const splitUnit = players ? splitTotal / players : 0
  return { split, direct, splitTotal, directTotal, splitUnit }
}

/** Extra-cost amount owed by one payment group: its own direct items + its share of the split ones. */
export function extrasForGroup(extras, group, headTotal) {
  const headcount = Number(group.headcount) || 0
  const { splitUnit } = extrasSummary(extras, headTotal)
  const directTotal = (extras || [])
    .filter((e) => e.payment_group_id === group.id)
    .reduce((s, e) => s + (Number(e.amount) || 0), 0)
  const splitShare = splitUnit * headcount
  return { directTotal, splitShare, total: directTotal + splitShare }
}

/**
 * @param {Object} session - see resolveRates
 * @param {Object} group - { id, payer_status_snapshot, headcount }
 * @param {number} [headTotal] - sum of all headcounts in the session; defaults to this group's own headcount
 * @param {Array} [extras] - all additional-cost rows for the session
 */
export function calcGroup(session, group, headTotal, extras) {
  const headcount = Number(group.headcount) || 1
  const head = headTotal == null ? headcount : headTotal

  const { shuttleUnitCost, courtUnitCost } = resolveRates(session, head)
  const ex = extrasForGroup(extras, group, head)

  const courtTotal = courtUnitCost * headcount
  const shuttleTotal = shuttleUnitCost * headcount
  const baseCost = courtTotal + shuttleTotal
  const actualCost = baseCost + ex.total

  const isGuest = group.payer_status_snapshot === 'guest'
  const amountToPay = isGuest
    ? session.guest_fixed_rate * headcount + ex.total
    : actualCost

  // Extra costs are pass-through (collected and paid straight back out), so
  // they don't affect the surplus a guest generates.
  const fundsGenerated = isGuest ? session.guest_fixed_rate * headcount - baseCost : 0

  return {
    courtUnitCost,
    shuttleUnitCost,
    courtTotal,
    shuttleTotal,
    extrasDirect: ex.directTotal,
    extrasSplitShare: ex.splitShare,
    extrasTotal: ex.total,
    baseCost,
    actualCost,
    amountToPay,
    fundsGenerated,
  }
}

export function calcSessionTotals(session, groups, extras) {
  const headTotal = totalHeadcount(groups)
  return (groups || []).reduce(
    (acc, g) => {
      const r = calcGroup(session, g, headTotal, extras)
      acc.totalCollected += r.amountToPay
      acc.totalFunds += r.fundsGenerated
      return acc
    },
    { totalCollected: 0, totalFunds: 0 }
  )
}

export const money = (n) =>
  Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Peso amount that may legitimately be negative (credits, refunds owed). */
export const peso = (n) => {
  const v = Number(n) || 0
  return v < 0 ? `-₱${money(Math.abs(v))}` : `₱${money(v)}`
}
