import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { calcGroup, calcSessionTotals, resolveRates, totalHeadcount, money } from '../lib/calc'

const todayStr = () => new Date().toISOString().slice(0, 10)

export default function SessionPage() {
  const [session, setSessionRow] = useState(null)
  const [groups, setGroups] = useState([])
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)

  // new-group form state
  const [payerId, setPayerId] = useState('')
  const [headcount, setHeadcount] = useState(1)
  const [water, setWater] = useState(0)
  const [penalty, setPenalty] = useState(0)
  const [members, setMembers] = useState('')

  async function loadEverything() {
    setLoading(true)
    const { data: playersData } = await supabase
      .from('players')
      .select('*')
      .eq('active', true)
      .order('name')
    setPlayers(playersData || [])

    // find or create today's session
    const date = todayStr()
    let { data: existing } = await supabase
      .from('sessions')
      .select('*')
      .eq('session_date', date)
      .maybeSingle()

    if (!existing) {
      const { data: created, error } = await supabase
        .from('sessions')
        .insert({ session_date: date })
        .select()
        .single()
      if (error) {
        alert(error.message)
        setLoading(false)
        return
      }
      existing = created
    }
    setSessionRow(existing)

    const { data: groupsData } = await supabase
      .from('payment_groups')
      .select('*, players(name)')
      .eq('session_id', existing.id)
      .order('created_at')
    setGroups(groupsData || [])
    setLoading(false)
  }

  useEffect(() => { loadEverything() }, [])

  async function updateSessionField(field, value) {
    // optimistic: reflect the change immediately so derived rates recalc without a round-trip
    setSessionRow((prev) => (prev ? { ...prev, [field]: value } : prev))
    const { data, error } = await supabase
      .from('sessions')
      .update({ [field]: value })
      .eq('id', session.id)
      .select()
      .single()
    if (!error) setSessionRow(data)
  }

  async function addGroup(e) {
    e.preventDefault()
    if (!payerId) return
    const payer = players.find((p) => p.id === payerId)
    const { error } = await supabase.from('payment_groups').insert({
      session_id: session.id,
      payer_id: payerId,
      payer_status_snapshot: payer.status,
      headcount: Number(headcount) || 1,
      water_cost: Number(water) || 0,
      penalty: Number(penalty) || 0,
      members: members.trim() || null,
    })
    if (error) {
      alert(error.message)
      return
    }
    setPayerId('')
    setHeadcount(1)
    setWater(0)
    setPenalty(0)
    setMembers('')
    loadEverything()
  }

  async function removeGroup(id) {
    await supabase.from('payment_groups').delete().eq('id', id)
    loadEverything()
  }

  if (loading || !session) return <p>Loading today's session…</p>

  const headTotal = totalHeadcount(groups)
  const rates = resolveRates(session, headTotal)
  const splitMode = session.court_fee_mode === 'split'
  const totals = calcSessionTotals(session, groups)

  return (
    <div>
      <div className="panel">
        <h2>Session settings — {session.session_date}</h2>

        <div className="field-row">
          <div className="field">
            <label>Court fee — how it's split</label>
            <select
              value={session.court_fee_mode || 'per_person'}
              onChange={(e) => updateSessionField('court_fee_mode', e.target.value)}
            >
              <option value="per_person">Fixed amount per person</option>
              <option value="split">Total court fee ÷ all players</option>
            </select>
          </div>
          {splitMode ? (
            <div className="field">
              <label>Total court fee (whole session)</label>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={session.court_fee_total ?? 0}
                onChange={(e) => updateSessionField('court_fee_total', Number(e.target.value))}
              />
            </div>
          ) : (
            <div className="field">
              <label>Court fee per person</label>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={session.court_fee_per_slot}
                onChange={(e) => updateSessionField('court_fee_per_slot', Number(e.target.value))}
              />
            </div>
          )}
          <div className="field">
            <label>Guest fixed rate (per person)</label>
            <input
              type="number"
              step="0.01"
              inputMode="decimal"
              value={session.guest_fixed_rate}
              onChange={(e) => updateSessionField('guest_fixed_rate', Number(e.target.value))}
            />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label>Shuttles used this session</label>
            <input
              type="number"
              step="1"
              min="0"
              inputMode="decimal"
              value={session.shuttle_count ?? 0}
              onChange={(e) => updateSessionField('shuttle_count', Number(e.target.value))}
            />
          </div>
          <div className="field">
            <label>Price per shuttle</label>
            <input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={session.shuttle_price_each ?? 0}
              onChange={(e) => updateSessionField('shuttle_price_each', Number(e.target.value))}
            />
          </div>
          <div className="field" />
        </div>

        <div className="rate-readout">
          <div className="rate-chip">
            <span className="rate-label">Players so far</span>
            <span className="rate-value">{headTotal || '—'}</span>
          </div>
          <div className="rate-chip">
            <span className="rate-label">Shuttle cost / person</span>
            <span className="rate-value">
              ₱{money(rates.shuttleUnitCost)}
              {headTotal > 0 && (
                <small>
                  {' '}
                  = ₱{money(rates.shuttleTotalCost)} ÷ {headTotal}
                </small>
              )}
            </span>
          </div>
          <div className="rate-chip">
            <span className="rate-label">Court fee / person</span>
            <span className="rate-value">
              ₱{money(rates.courtUnitCost)}
              {splitMode && headTotal > 0 && (
                <small>
                  {' '}
                  = ₱{money(rates.courtFeeTotal)} ÷ {headTotal}
                </small>
              )}
            </span>
          </div>
        </div>
        {splitMode && headTotal === 0 && (
          <p className="hint">Per-person amounts appear once you add players below.</p>
        )}
      </div>

      <div className="panel">
        <h2>Add a payment group</h2>
        <form onSubmit={addGroup}>
          <div className="field-row">
            <div className="field" style={{ flex: 2 }}>
              <label>Who's paying</label>
              <select value={payerId} onChange={(e) => setPayerId(e.target.value)}>
                <option value="">Select a player…</option>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.status === 'regular' ? 'Regular' : 'Guest'})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Headcount (this + anyone they're covering)</label>
              <input
                type="number"
                min="1"
                inputMode="numeric"
                value={headcount}
                onChange={(e) => setHeadcount(e.target.value)}
              />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label>Water cost (optional)</label>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={water}
                onChange={(e) => setWater(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Penalty (optional)</label>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={penalty}
                onChange={(e) => setPenalty(e.target.value)}
              />
            </div>
            <div className="field" style={{ flex: 2 }}>
              <label>Who's covered (note, optional)</label>
              <input value={members} onChange={(e) => setMembers(e.target.value)} placeholder="e.g. wife + 3 friends" />
            </div>
          </div>
          <button className="primary" type="submit">Add to session</button>
        </form>
      </div>

      <div className="panel">
        <h2>Today's ledger</h2>
        {groups.length === 0 ? (
          <div className="empty-state">No one added yet. Add the first payment group above.</div>
        ) : (
          <div className="table-wrap">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Payer</th>
                  <th>Status</th>
                  <th className="num">Headcount</th>
                  <th className="num">Actual cost</th>
                  <th className="num">Amount to pay</th>
                  <th className="num">Funds</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const r = calcGroup(session, g, headTotal)
                  return (
                    <tr key={g.id} className={g.payer_status_snapshot === 'guest' ? 'row-guest' : ''}>
                      <td>
                        {g.players?.name}
                        {g.members && <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>+ {g.members}</div>}
                      </td>
                      <td>
                        <span className={`badge ${g.payer_status_snapshot === 'regular' ? 'badge-regular' : 'badge-guest'}`}>
                          {g.payer_status_snapshot === 'regular' ? 'Regular' : 'Guest'}
                        </span>
                      </td>
                      <td className="num">{g.headcount}</td>
                      <td className="num">₱{money(r.actualCost)}</td>
                      <td className="num"><strong>₱{money(r.amountToPay)}</strong></td>
                      <td className="num">{r.fundsGenerated > 0 ? `₱${money(r.fundsGenerated)}` : '—'}</td>
                      <td>
                        <button className="danger-link" onClick={() => removeGroup(g.id)}>Remove</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="summary-row">
          <div className="summary-card">
            <div className="label">Total collected today</div>
            <div className="value">₱{money(totals.totalCollected)}</div>
          </div>
          <div className="summary-card gold">
            <div className="label">Funds generated today</div>
            <div className="value">₱{money(totals.totalFunds)}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
