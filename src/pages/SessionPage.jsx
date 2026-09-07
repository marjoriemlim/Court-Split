import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import {
  calcGroup,
  calcSessionTotals,
  resolveRates,
  extrasSummary,
  totalHeadcount,
  money,
} from '../lib/calc'

const todayStr = () => new Date().toISOString().slice(0, 10)

export default function SessionPage() {
  const [session, setSessionRow] = useState(null)
  const [groups, setGroups] = useState([])
  const [extras, setExtras] = useState([])
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)

  // "covering others" form state
  const [payerId, setPayerId] = useState('')
  const [headcount, setHeadcount] = useState(2)
  const [members, setMembers] = useState('')

  // new additional-cost form state
  const [costLabel, setCostLabel] = useState('')
  const [costAmount, setCostAmount] = useState('')
  const [costTarget, setCostTarget] = useState('') // '' = split among everyone, else payment_group id

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

    const { data: extrasData } = await supabase
      .from('extra_costs')
      .select('*')
      .eq('session_id', existing.id)
      .order('created_at')
    setExtras(extrasData || [])

    setLoading(false)
  }

  useEffect(() => { loadEverything() }, [])

  const groupByPayer = useMemo(() => {
    const m = new Map()
    groups.forEach((g) => m.set(g.payer_id, g))
    return m
  }, [groups])

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

  // Toggle a roster player in/out of today's session (headcount 1).
  async function togglePlayer(p) {
    const existing = groupByPayer.get(p.id)
    if (existing) {
      const hc = Number(existing.headcount) || 1
      if (hc > 1 || existing.members) {
        const detail = existing.members ? ` (${existing.members})` : ''
        if (!window.confirm(`${p.name} is covering a headcount of ${hc}${detail}. Remove from the session?`)) return
      }
      await supabase.from('payment_groups').delete().eq('id', existing.id)
    } else {
      const { error } = await supabase.from('payment_groups').insert({
        session_id: session.id,
        payer_id: p.id,
        payer_status_snapshot: p.status,
        headcount: 1,
      })
      if (error) {
        alert(error.message)
        return
      }
    }
    loadEverything()
  }

  async function addAll() {
    const missing = players.filter((p) => !groupByPayer.has(p.id))
    if (missing.length === 0) return
    const { error } = await supabase.from('payment_groups').insert(
      missing.map((p) => ({
        session_id: session.id,
        payer_id: p.id,
        payer_status_snapshot: p.status,
        headcount: 1,
      }))
    )
    if (error) {
      alert(error.message)
      return
    }
    loadEverything()
  }

  async function addCoveringGroup(e) {
    e.preventDefault()
    if (!payerId) return
    const payer = players.find((p) => p.id === payerId)
    const { error } = await supabase.from('payment_groups').insert({
      session_id: session.id,
      payer_id: payerId,
      payer_status_snapshot: payer.status,
      headcount: Number(headcount) || 1,
      members: members.trim() || null,
    })
    if (error) {
      alert(error.message)
      return
    }
    setPayerId('')
    setHeadcount(2)
    setMembers('')
    loadEverything()
  }

  async function updateGroupField(id, field, value) {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, [field]: value } : g)))
    await supabase.from('payment_groups').update({ [field]: value }).eq('id', id)
  }

  async function removeGroup(id) {
    await supabase.from('payment_groups').delete().eq('id', id)
    loadEverything()
  }

  async function addExtra(e) {
    e.preventDefault()
    if (!costLabel.trim() || costAmount === '' || Number.isNaN(Number(costAmount))) return
    const { error } = await supabase.from('extra_costs').insert({
      session_id: session.id,
      label: costLabel.trim(),
      amount: Number(costAmount) || 0,
      payment_group_id: costTarget || null,
    })
    if (error) {
      alert(error.message)
      return
    }
    setCostLabel('')
    setCostAmount('')
    setCostTarget('')
    loadEverything()
  }

  async function removeExtra(id) {
    await supabase.from('extra_costs').delete().eq('id', id)
    loadEverything()
  }

  if (loading || !session) return <p>Loading today's session…</p>

  const headTotal = totalHeadcount(groups)
  const rates = resolveRates(session, headTotal)
  const exSummary = extrasSummary(extras, headTotal)
  const splitMode = session.court_fee_mode === 'split'
  const totals = calcSessionTotals(session, groups, extras)
  const notYetIn = players.filter((p) => !groupByPayer.has(p.id))

  const targetName = (gid) => groups.find((g) => g.id === gid)?.players?.name || 'Unknown'

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
        <div className="panel-head">
          <h2>Who's playing today</h2>
          <span className="muted">
            {groups.length} of {players.length} selected
            {notYetIn.length > 0 && (
              <>
                {' · '}
                <button type="button" className="link-btn" onClick={addAll}>Add all</button>
              </>
            )}
          </span>
        </div>
        {players.length === 0 ? (
          <div className="empty-state">No active players. Add some on the Players tab.</div>
        ) : (
          <div className="roster-picker">
            {players.map((p) => {
              const on = groupByPayer.has(p.id)
              return (
                <button
                  type="button"
                  key={p.id}
                  className={`roster-chip ${on ? 'on' : ''}`}
                  aria-pressed={on}
                  onClick={() => togglePlayer(p)}
                >
                  <span className="roster-check" aria-hidden="true">{on ? '✓' : '+'}</span>
                  <span className="roster-name">{p.name}</span>
                  <span className={`badge ${p.status === 'regular' ? 'badge-regular' : 'badge-guest'}`}>
                    {p.status === 'regular' ? 'Regular' : 'Guest'}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <details className="covering">
          <summary>Someone covering others?</summary>
          <form onSubmit={addCoveringGroup}>
            <div className="field-row">
              <div className="field" style={{ flex: 2 }}>
                <label>Who's paying</label>
                <select value={payerId} onChange={(e) => setPayerId(e.target.value)}>
                  <option value="">Select a player…</option>
                  {notYetIn.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.status === 'regular' ? 'Regular' : 'Guest'})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Headcount</label>
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
                <label>Who's covered (note, optional)</label>
                <input value={members} onChange={(e) => setMembers(e.target.value)} placeholder="e.g. wife + 3 friends" />
              </div>
            </div>
            <button className="primary" type="submit" disabled={!payerId}>Add group</button>
          </form>
          {notYetIn.length === 0 && (
            <p className="hint">Everyone on the roster is already in — adjust headcount in the ledger below.</p>
          )}
        </details>
      </div>

      <div className="panel">
        <h2>Additional costs</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Water, penalties, parking, snacks — anything extra. Charge it to one payer, or split it across everyone by headcount.
        </p>

        {extras.length > 0 && (
          <ul className="extra-list">
            {extras.map((x) => (
              <li key={x.id}>
                <span className="extra-name">{x.label}</span>
                <span className="extra-target">
                  {x.payment_group_id ? `→ ${targetName(x.payment_group_id)}` : '→ split among everyone'}
                </span>
                <span className="extra-amount">₱{money(x.amount)}</span>
                <button className="danger-link" onClick={() => removeExtra(x.id)}>Remove</button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={addExtra}>
          <div className="field-row">
            <div className="field" style={{ flex: 2 }}>
              <label>Name</label>
              <input
                value={costLabel}
                onChange={(e) => setCostLabel(e.target.value)}
                placeholder="e.g. Water, Late penalty, Parking"
              />
            </div>
            <div className="field">
              <label>Price</label>
              <input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={costAmount}
                onChange={(e) => setCostAmount(e.target.value)}
              />
            </div>
            <div className="field" style={{ flex: 2 }}>
              <label>Charge to</label>
              <select value={costTarget} onChange={(e) => setCostTarget(e.target.value)}>
                <option value="">Split among everyone</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.players?.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button className="primary" type="submit">Add cost</button>
        </form>

        {exSummary.splitTotal > 0 && (
          <p className="hint">
            Split costs total ₱{money(exSummary.splitTotal)} —{' '}
            {headTotal > 0
              ? `₱${money(exSummary.splitUnit)} per person`
              : 'per-person share shows once players are added'}
            .
          </p>
        )}
      </div>

      <div className="panel">
        <h2>Today's ledger</h2>
        {groups.length === 0 ? (
          <div className="empty-state">No one added yet. Pick players above.</div>
        ) : (
          <div className="table-wrap">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Payer</th>
                  <th>Status</th>
                  <th className="num">Headcount</th>
                  <th className="num">Extras</th>
                  <th className="num">Actual cost</th>
                  <th className="num">Amount to pay</th>
                  <th className="num">Funds</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const r = calcGroup(session, g, headTotal, extras)
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
                      <td className="num">
                        <input
                          className="hc-input"
                          type="number"
                          min="1"
                          inputMode="numeric"
                          value={g.headcount}
                          onChange={(e) =>
                            setGroups((prev) =>
                              prev.map((x) => (x.id === g.id ? { ...x, headcount: e.target.value } : x))
                            )
                          }
                          onBlur={(e) =>
                            updateGroupField(g.id, 'headcount', Math.max(1, Math.floor(Number(e.target.value) || 1)))
                          }
                        />
                      </td>
                      <td className="num">{r.extrasTotal > 0 ? `₱${money(r.extrasTotal)}` : '—'}</td>
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
