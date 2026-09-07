// Pure calculation functions — no side effects, easy to reason about and test.

/**
 * @param {Object} session - { court_fee_per_slot, shuttle_unit_cost, guest_fixed_rate }
 * @param {Object} group - { payer_status_snapshot, headcount, water_cost, penalty }
 */
export function calcGroup(session, group) {
  const headcount = Number(group.headcount) || 1
  const water = Number(group.water_cost) || 0
  const penalty = Number(group.penalty) || 0

  const courtTotal = session.court_fee_per_slot * headcount
  const shuttleTotal = session.shuttle_unit_cost * headcount
  const actualCost = courtTotal + shuttleTotal + water

  const isGuest = group.payer_status_snapshot === 'guest'
  const amountToPay = isGuest
    ? session.guest_fixed_rate * headcount + penalty
    : actualCost + penalty

  const fundsGenerated = isGuest
    ? session.guest_fixed_rate * headcount - actualCost
    : 0

  return {
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
  return groups.reduce(
    (acc, g) => {
      const r = calcGroup(session, g)
      acc.totalCollected += r.amountToPay
      acc.totalFunds += r.fundsGenerated
      return acc
    },
    { totalCollected: 0, totalFunds: 0 }
  )
}

export const money = (n) =>
  Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
