import { useState } from 'react'
import { supabase } from './supabaseClient'

const Mark = () => (
  <div className="mark-plate mark-plate-lg"><img src="/logo.png" alt="Ilumsa" className="mark-img" /></div>
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
          <div className="sub">ALZA HOMBRES</div>
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
