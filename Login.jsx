import { useState } from 'react'
import { supabase } from './supabaseClient'

const Mark = () => (
  <svg className="mark" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" rx="9" fill="#E96A0C"/>
    <path d="M8 27h6V16l7-6 5 4-4 4v9h4" stroke="white" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="13" cy="30" r="2.4" fill="white"/>
    <circle cx="24" cy="30" r="2.4" fill="white"/>
  </svg>
)

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) setError('Correo o contraseña incorrectos. Si es tu primer ingreso, pide a la administradora que verifique tu cuenta en Supabase.')
  }

  return (
    <div id="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <Mark />
          <div>
            <div className="name">ILUMSA</div>
            <div className="sub">ALZA HOMBRES</div>
          </div>
        </div>
        <h1>Gestión de flota</h1>
        <p>Ingresa con la cuenta que te creó la administradora para ver disponibilidad, tarifas y cotizar servicios.</p>
        {error && <div className="login-error">{error}</div>}
        <form onSubmit={handleLogin}>
          <div className="field">
            <label>Correo</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tuemail@ilumsa.cl" required />
          </div>
          <div className="field">
            <label>Contraseña</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          <button className="btn-primary" type="submit" disabled={loading}>{loading ? 'Ingresando…' : 'Entrar'}</button>
        </form>
        <div className="login-note">
          Acceso restringido: solo las 3 cuentas creadas por la administradora en Supabase pueden entrar. Si olvidaste tu contraseña, pídele que te la restablezca desde el panel.
        </div>
      </div>
    </div>
  )
}
