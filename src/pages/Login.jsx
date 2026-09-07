import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    const { error } = await supabase.auth.signInWithOtp({ email })
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
