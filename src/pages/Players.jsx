import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function Players() {
  const [players, setPlayers] = useState([])
  const [name, setName] = useState('')
  const [status, setStatus] = useState('regular')
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .order('status', { ascending: true })
      .order('name', { ascending: true })
    if (!error) setPlayers(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function addPlayer(e) {
    e.preventDefault()
    if (!name.trim()) return
    const { error } = await supabase.from('players').insert({ name: name.trim(), status })
    if (!error) {
      setName('')
      setStatus('regular')
      load()
    } else {
      alert(error.message)
    }
  }

  async function toggleStatus(player) {
    const newStatus = player.status === 'regular' ? 'guest' : 'regular'
    await supabase.from('players').update({ status: newStatus }).eq('id', player.id)
    load()
  }

  async function toggleActive(player) {
    await supabase.from('players').update({ active: !player.active }).eq('id', player.id)
    load()
  }

  return (
    <div>
      <div className="panel">
        <h2>Add a player</h2>
        <form onSubmit={addPlayer} className="field-row">
          <div className="field" style={{ flex: 2 }}>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Carl" />
          </div>
          <div className="field">
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="regular">Regular</option>
              <option value="guest">Guest</option>
            </select>
          </div>
          <div className="field" style={{ justifyContent: 'flex-end' }}>
            <button className="primary" type="submit">Add player</button>
          </div>
        </form>
      </div>

      <div className="panel">
        <h2>Roster</h2>
        {loading ? (
          <p>Loading…</p>
        ) : players.length === 0 ? (
          <div className="empty-state">No players yet — add your first one above.</div>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id} className={p.status === 'guest' ? 'row-guest' : ''}>
                  <td>{p.name}</td>
                  <td>
                    <span className={`badge ${p.status === 'regular' ? 'badge-regular' : 'badge-guest'}`}>
                      {p.status === 'regular' ? 'Regular' : 'Guest'}
                    </span>
                  </td>
                  <td>{p.active ? 'Yes' : 'No'}</td>
                  <td style={{ display: 'flex', gap: 12 }}>
                    <button className="danger-link" onClick={() => toggleStatus(p)}>
                      Switch to {p.status === 'regular' ? 'Guest' : 'Regular'}
                    </button>
                    <button className="danger-link" onClick={() => toggleActive(p)}>
                      {p.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
