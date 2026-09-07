import { useEffect, useState } from 'react'
import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import Login from './pages/Login'
import Players from './pages/Players'
import SessionPage from './pages/SessionPage'
import History from './pages/History'

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return <div className="app-shell">Loading…</div>
  }

  if (!session) {
    return <Login />
  }

  return (
    <div className="app-shell">
      <header className="court-header">
        <div>
          <h1>Shuttle Ledger</h1>
          <div className="tagline">Court fees, sorted — every Friday.</div>
        </div>
        <button className="ghost" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </header>

      <nav className="tabs">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
          Today's session
        </NavLink>
        <NavLink to="/players" className={({ isActive }) => (isActive ? 'active' : '')}>
          Players
        </NavLink>
        <NavLink to="/history" className={({ isActive }) => (isActive ? 'active' : '')}>
          History
        </NavLink>
      </nav>

      <Routes>
        <Route path="/" element={<SessionPage />} />
        <Route path="/players" element={<Players />} />
        <Route path="/history" element={<History />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
