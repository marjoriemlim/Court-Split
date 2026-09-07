import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { calcSessionTotals, money } from '../lib/calc'

export default function History() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: sessions } = await supabase
        .from('sessions')
        .select('*, payment_groups(*), extra_costs(*)')
        .order('session_date', { ascending: false })

      const withTotals = (sessions || []).map((s) => ({
        ...s,
        totals: calcSessionTotals(s, s.payment_groups || [], s.extra_costs || []),
      }))
      setRows(withTotals)
      setLoading(false)
    }
    load()
  }, [])

  const accumulated = rows.reduce((sum, r) => sum + r.totals.totalFunds, 0)

  if (loading) return <p>Loading history…</p>

  return (
    <div>
      <div className="panel">
        <div className="summary-row">
          <div className="summary-card gold">
            <div className="label">Total accumulated funds (all time)</div>
            <div className="value">₱{money(accumulated)}</div>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Past sessions</h2>
        {rows.length === 0 ? (
          <div className="empty-state">No sessions recorded yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="num">Players covered</th>
                  <th className="num">Total collected</th>
                  <th className="num">Funds generated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.session_date}</td>
                    <td className="num">
                      {(r.payment_groups || []).reduce((n, g) => n + g.headcount, 0)}
                    </td>
                    <td className="num">₱{money(r.totals.totalCollected)}</td>
                    <td className="num">₱{money(r.totals.totalFunds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
