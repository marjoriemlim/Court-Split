import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    // Send people back to where this build actually lives. BASE_URL is the
    // `base` from vite.config.js ('/court-split/'), so this resolves to
    // https://<user>.github.io/court-split/ in production and
    // http://localhost:5173/court-split/ in dev — no hardcoded host.
    const emailRedirectTo = `${window.location.origin}${import.meta.env.BASE_URL}`
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo },
    })
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <div className="app-shell" style={{ maxWidth: 380, paddingTop: 80 }}>
      <h1 style={{ marginBottom: 6 }}>Court Split</h1>
      <p style={{ color: 'var(--ink-soft)', marginBottom: 24 }}>
        Sign in to manage sessions and payments.
      </p>
      {sent ? (
        <div className="panel">
          Check <strong>{email}</strong> for a sign-in link.
        </div>
      ) : (
        <form onSubmit={handleLogin} className="panel">
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          {error && <p style={{ color: '#a3402f', fontSize: 13 }}>{error}</p>}
          <button className="primary" type="submit">Send sign-in link</button>
        </form>
      )}
    </div>
  )
}
