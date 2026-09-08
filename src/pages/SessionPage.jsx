import { useEffect, useMemo, useRef, useState, Fragment } from 'react'
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

const TEMP = 'tmp:'
const isTemp = (id) => typeof id === 'string' && id.startsWith(TEMP)

function StatusBadge({ status }) {
  return (
    <span className={`badge ${status === 'regular' ? 'badge-regular' : 'badge-guest'}`}>
      {status === 'regular' ? 'Regular' : 'Guest'}
    </span>
  )
}

function PlayerChip({ name, status, on, onClick }) {
  return (
    <button type="button" className={`roster-chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick}>
      <span className="roster-check" aria-hidden="true">{on ? '✓' : '+'}</span>
      <span className="roster-name">{name}</span>
      <StatusBadge status={status} />
    </button>
  )
}

// Holds its own text while focused so typing never fights the saved value:
// clearing the box to retype no longer snaps to 0, and a late server echo
// can't overwrite what you're in the middle of entering.
function NumberField({ label, value, onCommit, step = '0.01', min }) {
  const [text, setText] = useState(() => String(value ?? 0))
  const focused = useRef(false)

  useEffect(() => {
    if (!focused.current) setText(String(value ?? 0))
  }, [value])

  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="number"
        step={step}
        min={min}
        inputMode="decimal"
        value={text}
        onFocus={() => { focused.current = true }}
        onBlur={() => { focused.current = false; setText(String(value ?? 0)) }}
        onChange={(e) => {
          setText(e.target.value)
          onCommit(e.target.value === '' ? 0 : Number(e.target.value))
        }}
      />
    </div>
  )
}

// Module-level so the <input> keeps focus while typing (a component defined
// inside the page would be a new type every render and remount the input).
function HeadcountCell({ row, setGroups, commit }) {
  return (
    <input
      className="hc-input"
      type="number"
      min="1"
      inputMode="numeric"
      value={row.headcount}
      onChange={(e) =>
        setGroups((prev) => prev.map((x) => (x.id === row.id ? { ...x, headcount: e.target.value } : x)))
      }
      onBlur={(e) => commit(row, Math.max(1, Math.floor(Number(e.target.value) || 1)))}
    />
  )
}

export default function SessionPage() {
  const [session, setSessionRow] = useState(null)
  const [groups, setGroups] = useState([])
  const [extras, setExtras] = useState([])
  const [players, setPlayers] = useState([])
  const [playerGroups, setPlayerGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(() => new Set())
  const [syncing, setSyncing] = useState(false)
  const [saveError, setSaveError] = useState('')

  // "covering others" form state
  const [payerId, setPayerId] = useState('')
  const [headcount, setHeadcount] = useState(2)
  const [members, setMembers] = useState('')

  // new additional-cost form state
  const [costLabel, setCostLabel] = useState('')
  const [costAmount, setCostAmount] = useState('')
  const [costTarget, setCostTarget] = useState('') // '' = split among everyone, else payment_group id

  // ── Deferred writes ──────────────────────────────────────────────
  // Roster taps update local state instantly and queue the real insert/delete.
  // A debounce batches a burst of taps into one round-trip, and nothing
  // re-reads the session row, so the settings above are never clobbered.
  const sessionIdRef = useRef(null)
  const idByPayer = useRef(new Map())    // payer_id -> real payment_group id
  const pendingAdds = useRef(new Map())  // payer_id -> optimistic row awaiting insert
  const pendingDels = useRef(new Map())  // payer_id -> real row awaiting delete
  const flushTimer = useRef(null)
  const flushChain = useRef(Promise.resolve())
  const sessionTimers = useRef({})

  useEffect(() => { sessionIdRef.current = session?.id ?? null }, [session])

  async function loadEverything() {
    setLoading(true)
    const { data: playersData } = await supabase
      .from('players')
      .select('id, name, status, group_id')
      .eq('active', true)
      .order('name')
    setPlayers(playersData || [])

    const { data: pgroups } = await supabase.from('player_groups').select('*')
    setPlayerGroups(pgroups || [])

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
        setSaveError(error.message)
        setLoading(false)
        return
      }
      existing = created
    }
    setSessionRow(existing)
    sessionIdRef.current = existing.id

    const { data: groupsData } = await supabase
      .from('payment_groups')
      .select('*, players(name, group_id)')
      .eq('session_id', existing.id)
      .order('created_at')
    setGroups(groupsData || [])
    idByPayer.current = new Map((groupsData || []).map((g) => [g.payer_id, g.id]))

    const { data: extrasData } = await supabase
      .from('extra_costs')
      .select('*')
      .eq('session_id', existing.id)
      .order('created_at')
    setExtras(extrasData || [])

    setLoading(false)
  }

  useEffect(() => { loadEverything() }, [])

  // Never leave queued roster changes unsaved.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushRoster() }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      flushRoster()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function doFlush() {
    const adds = Array.from(pendingAdds.current.values())
    const dels = Array.from(pendingDels.current.values())
    if (adds.length === 0 && dels.length === 0) return
    pendingAdds.current = new Map()
    pendingDels.current = new Map()

    setSyncing(true)
    try {
      if (dels.length) {
        const { error } = await supabase
          .from('payment_groups')
          .delete()
          .in('id', dels.map((r) => r.id))
        if (error) throw error
        dels.forEach((r) => idByPayer.current.delete(r.payer_id))
      }
      if (adds.length) {
        const { data, error } = await supabase
          .from('payment_groups')
          .insert(
            adds.map((t) => ({
              session_id: sessionIdRef.current,
              payer_id: t.payer_id,
              payer_status_snapshot: t.payer_status_snapshot,
              headcount: Math.max(1, Math.floor(Number(t.headcount) || 1)),
            }))
          )
          .select('*, players(name, group_id)')
        if (error) throw error
        const real = new Map((data || []).map((r) => [r.payer_id, r]))
        real.forEach((r, payerId) => idByPayer.current.set(payerId, r.id))
        setGroups((prev) =>
          prev.map((g) => (isTemp(g.id) && real.has(g.payer_id) ? real.get(g.payer_id) : g))
        )
      }
      setSaveError('')
    } catch (err) {
      setSaveError(err?.message || String(err))
      // roll the failed additions back out of the view
      setGroups((prev) => prev.filter((g) => !adds.some((a) => a.id === g.id)))
    } finally {
      setSyncing(false)
    }
  }

  function flushRoster() {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current)
      flushTimer.current = null
    }
    flushChain.current = flushChain.current.then(doFlush, doFlush)
    return flushChain.current
  }

  function scheduleFlush() {
    if (flushTimer.current) clearTimeout(flushTimer.current)
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null
      flushRoster()
    }, 600)
  }

  // ── Session settings ─────────────────────────────────────────────
  // Local state is the truth while you type; the write is debounced and the
  // response is deliberately NOT fed back into state.
  function updateSessionField(field, value) {
    setSessionRow((prev) => (prev ? { ...prev, [field]: value } : prev))
    clearTimeout(sessionTimers.current[field])
    sessionTimers.current[field] = setTimeout(async () => {
      const { error } = await supabase
        .from('sessions')
        .update({ [field]: value })
        .eq('id', sessionIdRef.current)
      setSaveError(error ? `Couldn't save ${field.replace(/_/g, ' ')} — ${error.message}` : '')
    }, 500)
  }

  // ── Roster ───────────────────────────────────────────────────────
  function optimisticRow(p) {
    return {
      id: TEMP + p.id,
      session_id: sessionIdRef.current,
      payer_id: p.id,
      payer_status_snapshot: p.status,
      headcount: 1,
      members: null,
      players: { name: p.name, group_id: p.group_id },
    }
  }

  function queueAdd(p) {
    // re-adding someone whose delete hasn't gone out yet just cancels the delete
    const revived = pendingDels.current.get(p.id)
    if (revived) {
      pendingDels.current.delete(p.id)
      return revived
    }
    const row = optimisticRow(p)
    pendingAdds.current.set(p.id, row)
    return row
  }

  function queueRemove(row) {
    if (isTemp(row.id)) pendingAdds.current.delete(row.payer_id)
    else pendingDels.current.set(row.payer_id, row)
  }

  function togglePlayer(p) {
    const existing = groups.find((g) => g.payer_id === p.id)
    if (existing) {
      const hc = Number(existing.headcount) || 1
      if (hc > 1 || existing.members) {
        const detail = existing.members ? ` (${existing.members})` : ''
        if (!window.confirm(`${p.name} is covering a headcount of ${hc}${detail}. Remove from the session?`)) return
      }
      queueRemove(existing)
      setGroups((prev) => prev.filter((g) => g.id !== existing.id))
    } else {
      const row = queueAdd(p)
      setGroups((prev) => [...prev, row])
    }
    scheduleFlush()
  }

  function addAll() {
    const missing = players.filter((p) => !groups.some((g) => g.payer_id === p.id))
    if (missing.length === 0) return
    const rows = missing.map(queueAdd)
    setGroups((prev) => [...prev, ...rows])
    scheduleFlush()
  }

  function removeRows(rows) {
    if (rows.length === 0) return
    rows.forEach(queueRemove)
    const ids = new Set(rows.map((r) => r.id))
    setGroups((prev) => prev.filter((g) => !ids.has(g.id)))
    scheduleFlush()
  }

  async function commitHeadcount(row, value) {
    setGroups((prev) => prev.map((g) => (g.id === row.id ? { ...g, headcount: value } : g)))
    if (isTemp(row.id)) {
      // not inserted yet — let the queued insert carry the new value
      const queued = pendingAdds.current.get(row.payer_id)
      if (queued) queued.headcount = value
      return
    }
    const { error } = await supabase
      .from('payment_groups')
      .update({ headcount: value })
      .eq('id', row.id)
    if (error) setSaveError(error.message)
  }

  async function addCoveringGroup(e) {
    e.preventDefault()
    if (!payerId) return
    await flushRoster()
    const payer = players.find((p) => p.id === payerId)
    const { data, error } = await supabase
      .from('payment_groups')
      .insert({
        session_id: sessionIdRef.current,
        payer_id: payerId,
        payer_status_snapshot: payer.status,
        headcount: Number(headcount) || 1,
        members: members.trim() || null,
      })
      .select('*, players(name, group_id)')
      .single()
    if (error) {
      setSaveError(error.message)
      return
    }
    idByPayer.current.set(data.payer_id, data.id)
    setGroups((prev) => [...prev, data])
    setPayerId('')
    setHeadcount(2)
    setMembers('')
  }

  // ── Additional costs ─────────────────────────────────────────────
  async function addExtra(e) {
    e.preventDefault()
    if (!costLabel.trim() || costAmount === '' || Number.isNaN(Number(costAmount))) return
    await flushRoster()
    let target = costTarget || null
    if (target && isTemp(target)) {
      target = idByPayer.current.get(target.slice(TEMP.length)) || null
    }
    const { data, error } = await supabase
      .from('extra_costs')
      .insert({
        session_id: sessionIdRef.current,
        label: costLabel.trim(),
        amount: Number(costAmount) || 0,
        payment_group_id: target,
      })
      .select()
      .single()
    if (error) {
      setSaveError(error.message)
      return
    }
    setExtras((prev) => [...prev, data])
    setCostLabel('')
    setCostAmount('')
    setCostTarget('')
  }

  async function removeExtra(id) {
    setExtras((prev) => prev.filter((x) => x.id !== id))
    const { error } = await supabase.from('extra_costs').delete().eq('id', id)
    if (error) setSaveError(error.message)
  }

  function toggleExpanded(key) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const groupByPayer = useMemo(() => {
    const m = new Map()
    groups.forEach((g) => m.set(g.payer_id, g))
    return m
  }, [groups])

  const pgName = (id) => playerGroups.find((g) => g.id === id)?.name

  if (loading || !session) return <p>Loading today's session…</p>

  const headTotal = totalHeadcount(groups)
  const rates = resolveRates(session, headTotal)
  const exSummary = extrasSummary(extras, headTotal)
  const splitMode = session.court_fee_mode === 'split'
  const totals = calcSessionTotals(session, groups, extras)
  const notYetIn = players.filter((p) => !groupByPayer.has(p.id))

  // Roster picker: one flat wrap of per-player chips. Members of the same group
  // (2+ playing) sit adjacent inside a tinted pair so they read as one unit,
  // but each person is still toggled individually.
  const pairable = new Map()
  playerGroups.forEach((pg) => {
    const mem = players.filter((p) => p.group_id === pg.id)
    if (mem.length >= 2) pairable.set(pg.id, { name: pg.name, members: mem })
  })
  const rosterUnits = []
  const placed = new Set()
  for (const p of players) {
    if (placed.has(p.id)) continue
    const pair = p.group_id ? pairable.get(p.group_id) : null
    if (pair) {
      pair.members.forEach((m) => placed.add(m.id))
      rosterUnits.push({ type: 'pair', key: p.group_id, ...pair })
    } else {
      placed.add(p.id)
      rosterUnits.push({ type: 'solo', key: p.id, player: p })
    }
  }

  const targetName = (gid) => groups.find((g) => g.id === gid)?.players?.name || 'Unknown'

  // Ledger rows: bucket payment groups by the payer's player-group so couples bill as one line.
  const byPlayerGroup = new Map()
  groups.forEach((g) => {
    const gid = g.players?.group_id
    if (!gid) return
    if (!byPlayerGroup.has(gid)) byPlayerGroup.set(gid, [])
    byPlayerGroup.get(gid).push(g)
  })
  const done = new Set()
  const ledgerRows = []
  for (const g of groups) {
    if (done.has(g.id)) continue
    const gid = g.players?.group_id
    const mates = gid ? byPlayerGroup.get(gid) : null
    if (mates && mates.length >= 2) {
      mates.forEach((m) => done.add(m.id))
      const parts = mates.map((m) => ({ row: m, calc: calcGroup(session, m, headTotal, extras) }))
      const sum = (fn) => parts.reduce((s, p) => s + fn(p), 0)
      ledgerRows.push({
        type: 'group',
        key: gid,
        title: pgName(gid) || parts.map((p) => p.row.players?.name).filter(Boolean).join(' & '),
        names: parts.map((p) => p.row.players?.name).filter(Boolean),
        parts,
        headcount: sum((p) => Number(p.row.headcount) || 0),
        allGuest: parts.every((p) => p.row.payer_status_snapshot === 'guest'),
        anyGuest: parts.some((p) => p.row.payer_status_snapshot === 'guest'),
        extrasTotal: sum((p) => p.calc.extrasTotal),
        actualCost: sum((p) => p.calc.actualCost),
        amountToPay: sum((p) => p.calc.amountToPay),
        fundsGenerated: sum((p) => p.calc.fundsGenerated),
      })
    } else {
      done.add(g.id)
      ledgerRows.push({ type: 'solo', key: g.id, row: g, calc: calcGroup(session, g, headTotal, extras) })
    }
  }

  return (
    <div>
      {saveError && (
        <div className="save-error">
          <span>{saveError}</span>
          <button className="link-btn" onClick={() => setSaveError('')}>Dismiss</button>
        </div>
      )}

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
            <NumberField
              label="Total court fee (whole session)"
              value={session.court_fee_total ?? 0}
              onCommit={(v) => updateSessionField('court_fee_total', v)}
            />
          ) : (
            <NumberField
              label="Court fee per person"
              value={session.court_fee_per_slot}
              onCommit={(v) => updateSessionField('court_fee_per_slot', v)}
            />
          )}
          <NumberField
            label="Guest fixed rate (per person)"
            value={session.guest_fixed_rate}
            onCommit={(v) => updateSessionField('guest_fixed_rate', v)}
          />
        </div>

        <div className="field-row">
          <NumberField
            label="Shuttles used this session"
            step="1"
            min="0"
            value={session.shuttle_count ?? 0}
            onCommit={(v) => updateSessionField('shuttle_count', v)}
          />
          <NumberField
            label="Price per shuttle"
            step="0.01"
            min="0"
            value={session.shuttle_price_each ?? 0}
            onCommit={(v) => updateSessionField('shuttle_price_each', v)}
          />
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
            {syncing && <span className="sync-dot" title="Saving…" />}
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
            {rosterUnits.map((u) =>
              u.type === 'solo' ? (
                <PlayerChip
                  key={u.key}
                  name={u.player.name}
                  status={u.player.status}
                  on={groupByPayer.has(u.player.id)}
                  onClick={() => togglePlayer(u.player)}
                />
              ) : (
                <div className="roster-pair" key={u.key} title={u.name}>
                  {u.members.map((m, i) => (
                    <Fragment key={m.id}>
                      {i > 0 && <span className="pair-link" aria-hidden="true">⁃</span>}
                      <PlayerChip
                        name={m.name}
                        status={m.status}
                        on={groupByPayer.has(m.id)}
                        onClick={() => togglePlayer(m)}
                      />
                    </Fragment>
                  ))}
                </div>
              )
            )}
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
        <p className="hint" style={{ marginTop: 0 }}>
          Couples &amp; groups show one combined total — expand a row to see or edit each person.
        </p>
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
                {ledgerRows.map((lr) => {
                  if (lr.type === 'solo') {
                    const { row: g, calc: r } = lr
                    return (
                      <tr key={g.id} className={g.payer_status_snapshot === 'guest' ? 'row-guest' : ''}>
                        <td>
                          {g.players?.name}
                          {g.members && <div className="sub-note">+ {g.members}</div>}
                        </td>
                        <td><StatusBadge status={g.payer_status_snapshot} /></td>
                        <td className="num">
                          <HeadcountCell row={g} setGroups={setGroups} commit={commitHeadcount} />
                        </td>
                        <td className="num">{r.extrasTotal > 0 ? `₱${money(r.extrasTotal)}` : '—'}</td>
                        <td className="num">₱{money(r.actualCost)}</td>
                        <td className="num"><strong>₱{money(r.amountToPay)}</strong></td>
                        <td className="num">{r.fundsGenerated > 0 ? `₱${money(r.fundsGenerated)}` : '—'}</td>
                        <td>
                          <button className="danger-link" onClick={() => removeRows([g])}>Remove</button>
                        </td>
                      </tr>
                    )
                  }

                  const isOpen = expanded.has(lr.key)
                  return (
                    <Fragment key={lr.key}>
                      <tr className={lr.allGuest ? 'row-guest' : ''}>
                        <td>
                          <button
                            type="button"
                            className="disclosure"
                            aria-expanded={isOpen}
                            onClick={() => toggleExpanded(lr.key)}
                          >
                            <span className="disclosure-caret">{isOpen ? '▾' : '▸'}</span>
                            {lr.title}
                          </button>
                          <div className="sub-note">{lr.names.join(' + ')}</div>
                        </td>
                        <td>
                          {lr.allGuest ? (
                            <StatusBadge status="guest" />
                          ) : lr.anyGuest ? (
                            <span className="badge badge-mixed">Mixed</span>
                          ) : (
                            <StatusBadge status="regular" />
                          )}
                        </td>
                        <td className="num">{lr.headcount}</td>
                        <td className="num">{lr.extrasTotal > 0 ? `₱${money(lr.extrasTotal)}` : '—'}</td>
                        <td className="num">₱{money(lr.actualCost)}</td>
                        <td className="num"><strong>₱{money(lr.amountToPay)}</strong></td>
                        <td className="num">{lr.fundsGenerated > 0 ? `₱${money(lr.fundsGenerated)}` : '—'}</td>
                        <td>
                          <button
                            className="danger-link"
                            onClick={() => removeRows(lr.parts.map((p) => p.row))}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                      {isOpen &&
                        lr.parts.map(({ row: g, calc: r }) => (
                          <tr key={g.id} className="subrow">
                            <td>
                              ↳ {g.players?.name}
                              {g.members && <span className="muted"> · + {g.members}</span>}
                            </td>
                            <td><StatusBadge status={g.payer_status_snapshot} /></td>
                            <td className="num">
                              <HeadcountCell row={g} setGroups={setGroups} commit={commitHeadcount} />
                            </td>
                            <td className="num">{r.extrasTotal > 0 ? `₱${money(r.extrasTotal)}` : '—'}</td>
                            <td className="num">₱{money(r.actualCost)}</td>
                            <td className="num">₱{money(r.amountToPay)}</td>
                            <td className="num">{r.fundsGenerated > 0 ? `₱${money(r.fundsGenerated)}` : '—'}</td>
                            <td>
                              <button className="danger-link" onClick={() => removeRows([g])}>Remove</button>
                            </td>
                          </tr>
                        ))}
                    </Fragment>
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
