import { useEffect, useState, useCallback } from 'react'
import { supabase } from './supabaseClient'
import Login from './Login.jsx'
import {
  isoDate, startOfWorkWeek, addDays, fmtMoney, fmtInputMoney, parseMoneyInput, DIAS, MESES,
  badgeClassFor, camionEstadoEnFecha, findAvailableTruck, priceFor,
} from './helpers.js'

const Mark = () => (
  <div className="mark-plate"><img src="/logo.png" alt="Ilumsa" className="mark-img" /></div>
)

// Iconos de navegación en SVG (más confiables entre navegadores que los emoji/símbolos unicode)
const NavIcons = {
  dashboard: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>,
  camiones: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 16V6a1 1 0 0 1 1-1h9v11"/><path d="M13 9h4l4 4v3h-8"/><circle cx="7.5" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/></svg>,
  reservas: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 3v3M16 3v3"/></svg>,
  tarifas: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M15 9.5c0-1.1-1.34-2-3-2s-3 .9-3 2 1.34 1.6 3 2 3 .9 3 2-1.34 2-3 2-3-.9-3-2M12 6v2M12 16v2"/></svg>,
  cotizaciones: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M9 12h6M9 16h6M9 8h3"/></svg>,
  conductores: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.9 3.13-7 7-7s7 3.1 7 7"/></svg>,
}

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = cargando, null = sin sesión
  const [perfil, setPerfil] = useState(null)
  const [view, setView] = useState('dashboard')
  const [toastMsg, setToastMsg] = useState('')
  const [calWeekStart, setCalWeekStart] = useState(startOfWorkWeek(new Date()))
  const [reservaModal, setReservaModal] = useState({ show: false, camionId: '', fecha: '', editReserva: null })

  const [camiones, setCamiones] = useState([])
  const [reservas, setReservas] = useState([])
  const [cotizaciones, setCotizaciones] = useState([])
  const [conductores, setConductores] = useState([])
  const [tarifaArriendo, setTarifaArriendo] = useState({})
  const [tarifasComunas, setTarifasComunas] = useState([])

  // ---------- Sesión ----------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) { setPerfil(null); return }
    supabase.from('perfiles').select('*').eq('id', session.user.id).single()
      .then(({ data, error }) => { if (!error) setPerfil(data) })
  }, [session])

  // ---------- Carga de datos + realtime ----------
  const loadAll = useCallback(async () => {
    const [c, r, q, ta, tc, cd] = await Promise.all([
      supabase.from('camiones').select('*').order('nombre'),
      supabase.from('reservas').select('*'),
      supabase.from('cotizaciones').select('*'),
      supabase.from('tarifas_arriendo').select('*'),
      supabase.from('tarifas_comunas').select('*').order('comuna'),
      supabase.from('conductores').select('*').order('nombre'),
    ])
    if (c.data) setCamiones(c.data)
    if (r.data) setReservas(r.data)
    if (q.data) setCotizaciones(q.data)
    if (ta.data) setTarifaArriendo(Object.fromEntries(ta.data.map(x => [x.tamano, x.valor])))
    if (tc.data) setTarifasComunas(tc.data)
    if (cd.data) setConductores(cd.data)
  }, [])

  useEffect(() => {
    if (!perfil) return
    loadAll()
    const channel = supabase.channel('flota-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'camiones' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservas' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cotizaciones' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tarifas_arriendo' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tarifas_comunas' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conductores' }, loadAll)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [perfil, loadAll])

  function toast(msg) { setToastMsg(msg); setTimeout(() => setToastMsg(''), 2400) }
  function openReserva(camionId, fecha) { setReservaModal({ show: true, camionId, fecha, editReserva: null }) }
  function openReservaEdit(reserva) { setReservaModal({ show: true, camionId: reserva.camion_id, fecha: reserva.fecha, editReserva: reserva }) }
  function closeReserva() { setReservaModal(m => ({ ...m, show: false })) }

  if (session === undefined) return <div className="loading-screen">Cargando…</div>
  if (!session) return <Login />
  if (!perfil) return <div className="loading-screen">Preparando tu cuenta… si esto no cambia, pide a la administradora que confirme tu perfil en Supabase.</div>

  const isAdmin = perfil.rol === 'Administradora'

  return (
    <div id="app" className="show">
      <Sidebar perfil={perfil} view={view} setView={setView} />
      <main className="main">
        {view === 'dashboard' && (
          <Dashboard
            perfil={perfil} camiones={camiones} reservas={reservas} cotizaciones={cotizaciones}
            tarifaArriendo={tarifaArriendo} tarifasComunas={tarifasComunas}
            calWeekStart={calWeekStart} setCalWeekStart={setCalWeekStart}
            setView={setView} toast={toast} openReserva={openReserva} openReservaEdit={openReservaEdit}
          />
        )}
        {view === 'camiones' && (
          <Camiones camiones={camiones} isAdmin={isAdmin} toast={toast} reload={loadAll} />
        )}
        {view === 'reservas' && (
          <Reservas
            camiones={camiones} reservas={reservas} conductores={conductores} tarifasComunas={tarifasComunas}
            perfil={perfil} toast={toast} reload={loadAll} openReserva={openReserva} openReservaEdit={openReservaEdit}
          />
        )}
        {view === 'conductores' && (
          <Conductores conductores={conductores} isAdmin={isAdmin} toast={toast} reload={loadAll} />
        )}
        {view === 'tarifas' && (
          <Tarifas
            tarifaArriendo={tarifaArriendo} tarifasComunas={tarifasComunas}
            isAdmin={isAdmin} toast={toast} reload={loadAll}
          />
        )}
        {view === 'cotizaciones' && (
          <Cotizaciones
            camiones={camiones} reservas={reservas} cotizaciones={cotizaciones}
            tarifaArriendo={tarifaArriendo} tarifasComunas={tarifasComunas}
            perfil={perfil} toast={toast} reload={loadAll}
          />
        )}
      </main>
      <ReservaModal
        show={reservaModal.show} onClose={closeReserva}
        camiones={camiones} tarifasComunas={tarifasComunas} conductores={conductores}
        perfil={perfil} toast={toast} reload={loadAll}
        initialCamionId={reservaModal.camionId} initialFecha={reservaModal.fecha} editReserva={reservaModal.editReserva}
      />
      <div className={`toast ${toastMsg ? 'show' : ''}`}>{toastMsg}</div>
    </div>
  )
}

// ============================================================
function Sidebar({ perfil, view, setView }) {
  const items = [
    ['dashboard', 'dashboard', 'Dashboard'],
    ['camiones', 'camiones', 'Camiones'],
    ['reservas', 'reservas', 'Reservas'],
    ['conductores', 'conductores', 'Conductores'],
    ['tarifas', 'tarifas', 'Tarifas'],
    ['cotizaciones', 'cotizaciones', 'Cotizaciones'],
  ]
  return (
    <aside className="sidebar">
      <div className="brand">
        <Mark />
        <div className="sub">ALZA HOMBRES</div>
      </div>
      <nav className="nav-group">
        {items.map(([key, icKey, label]) => (
          <button key={key} className={`nav-item ${view === key ? 'active' : ''}`} onClick={() => setView(key)}>
            <span className="ic">{NavIcons[icKey]}</span> {label}
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <div className="user-chip">
          <div className="user-avatar">{perfil.nombre.trim()[0].toUpperCase()}</div>
          <div className="user-meta">
            <div className="uname">{perfil.nombre}</div>
            <div className="urole">{perfil.rol}</div>
          </div>
        </div>
        <button className="logout-btn" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
      </div>
    </aside>
  )
}

// ============================================================
function Dashboard({ perfil, camiones, reservas, cotizaciones, tarifaArriendo, tarifasComunas, calWeekStart, setCalWeekStart, setView, toast, openReserva, openReservaEdit }) {
  const today = isoDate(new Date())
  const tomorrow = isoDate(addDays(new Date(), 1))
  const total = camiones.length
  let disp = 0, ocup = 0, mant = 0
  camiones.forEach(c => {
    const est = camionEstadoEnFecha(c, today, reservas)
    if (est === 'Disponible') disp++
    else if (est === 'Reservado' || est === 'En Trabajo') ocup++
    else if (est === 'Mantención' || est === 'Fuera de Servicio') mant++
  })
  const manana = reservas.filter(r => r.fecha === tomorrow).length
  const cotPend = cotizaciones.filter(c => c.estado === 'Pendiente').length

  const days = [...Array(5)].map((_, i) => addDays(calWeekStart, i)) // Lun–Vie

  const [qSize, setQSize] = useState('13')
  const [qDate, setQDate] = useState(today)
  const [qComuna, setQComuna] = useState(tarifasComunas[0]?.comuna || '')
  const [qResult, setQResult] = useState(null)
  useEffect(() => { if (!qComuna && tarifasComunas[0]) setQComuna(tarifasComunas[0].comuna) }, [tarifasComunas]) // eslint-disable-line

  function runSearch() {
    const truck = findAvailableTruck(camiones, reservas, qSize, qDate)
    if (!truck) { setQResult({ ok: false }); return }
    const price = priceFor(tarifaArriendo, tarifasComunas, qSize, qComuna)
    setQResult({ ok: true, truck, price })
  }

  const upcoming = reservas.filter(r => r.fecha >= today).sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(0, 5)
  const alerts = camiones.filter(c => c.estado_general === 'Mantención' || c.estado_general === 'Fuera de Servicio')

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Bienvenida, {perfil.nombre}</h1>
          <div className="greet">{perfil.rol}</div>
        </div>
        <div className="pill live"><span className="dot"></span> {new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      </div>

      <div className="stats-row">
        <div className="stat-card green"><div className="lbl">Camiones disponibles hoy</div><div className="val">{disp}</div><div className="of">de {total}</div></div>
        <div className="stat-card amber"><div className="lbl">Camiones ocupados hoy</div><div className="val">{ocup}</div><div className="of">de {total}</div></div>
        <div className="stat-card red"><div className="lbl">En mantención</div><div className="val">{mant}</div><div className="of">de {total}</div></div>
        <div className="stat-card blue"><div className="lbl">Servicios mañana</div><div className="val">{manana}</div><div className="of">reservas</div></div>
        <div className="stat-card purple"><div className="lbl">Cotizaciones pendientes</div><div className="val">{cotPend}</div><div className="of">por enviar</div></div>
      </div>

      <div className="grid-2col">
        <div>
          <div className="card">
            <div className="card-head">
              <h2>Calendario de camiones</h2>
              <div className="week-nav">
                <button onClick={() => setCalWeekStart(addDays(calWeekStart, -7))}>‹</button>
                <span className="range">{days[0].getDate()} – {days[4].getDate()} de {MESES[days[4].getMonth()].charAt(0) + MESES[days[4].getMonth()].slice(1).toLowerCase()}, {days[4].getFullYear()}</span>
                <button onClick={() => setCalWeekStart(addDays(calWeekStart, 7))}>›</button>
                <button className="today-btn" onClick={() => setCalWeekStart(startOfWorkWeek(new Date()))}>Hoy</button>
              </div>
            </div>
            <div className="cal-wrap">
              <table className="calendar">
                <thead><tr><th>Camión</th>{days.map(d => <th key={+d}>{DIAS[d.getDay()]} {d.getDate()}</th>)}</tr></thead>
                <tbody>
                  {camiones.map(c => (
                    <tr key={c.id}>
                      <td className="truck-cell">
                        <div className="tname">{c.nombre}</div>
                        <div className="tpat">Patente: {c.patente} · Aislado: {c.aislado}</div>
                      </td>
                      {days.map(d => {
                        const dIso = isoDate(d)
                        const est = camionEstadoEnFecha(c, dIso, reservas)
                        const cls = badgeClassFor(est)
                        if (est === 'Reservado' || est === 'En Trabajo') {
                          const r = reservas.find(rr => rr.camion_id === c.id && rr.fecha === dIso)
                          return (
                            <td key={+d}>
                              <div
                                className={`badge small-info ${cls} badge-clickable`}
                                title="Clic para ver / editar esta reserva"
                                onClick={() => r && openReservaEdit(r)}
                              >{est}<span className="b-sub">{r?.cliente}</span></div>
                            </td>
                          )
                        }
                        if (est === 'Mantención' || est === 'Fuera de Servicio') {
                          return <td key={+d}><div className={`badge small-info ${cls}`}>{est}<span className="b-sub">{est === 'Mantención' && c.hasta ? 'Hasta ' + c.hasta.slice(8,10)+'/'+c.hasta.slice(5,7) : ''}</span></div></td>
                        }
                        return (
                          <td key={+d}>
                            <div
                              className={`badge ${cls} badge-clickable`}
                              title="Clic para reservar este camión este día"
                              onClick={() => openReserva(c.id, dIso)}
                            >{est}</div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="legend">
              <span><i style={{background:'var(--green)'}}></i>Disponible</span>
              <span><i style={{background:'var(--amber)'}}></i>Reservado</span>
              <span><i style={{background:'var(--blue)'}}></i>En trabajo</span>
              <span><i style={{background:'var(--red)'}}></i>En mantención</span>
              <span><i style={{background:'var(--purple)'}}></i>Fuera de servicio</span>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Disponibilidad rápida</h2></div>
            <div className="quick-row">
              <div className="f-group"><label>Tamaño de camión</label>
                <select value={qSize} onChange={e => setQSize(e.target.value)}>
                  <option value="13">13 metros</option><option value="20">20 metros</option><option value="28">28 metros</option>
                </select>
              </div>
              <div className="f-group"><label>Fecha</label><input type="date" value={qDate} onChange={e => setQDate(e.target.value)} /></div>
              <div className="f-group"><label>Comuna / destino</label>
                <select value={qComuna} onChange={e => setQComuna(e.target.value)}>
                  {tarifasComunas.map(c => <option key={c.id} value={c.comuna}>{c.comuna}</option>)}
                </select>
              </div>
              <button className="btn-dark" onClick={runSearch}>Buscar disponibilidad</button>
            </div>
            {qResult && !qResult.ok && (
              <div className="result-box none"><div className="result-title no"><span className="ok-ic">×</span>Sin camiones de {qSize}m disponibles ese día</div></div>
            )}
            {qResult && qResult.ok && (
              <div className="result-box">
                <div className="result-title"><span className="ok-ic">✓</span>{qResult.truck.nombre} disponible</div>
                <div className="result-grid">
                  <div className="rl">Patente</div><div className="rv">{qResult.truck.patente}</div>
                  <div className="rl">Valor arriendo (por hora)</div><div className="rv">{fmtMoney(qResult.price.arriendo)}</div>
                  <div className="rl">Traslado a {qComuna}</div><div className="rv">{fmtMoney(qResult.price.traslado)}</div>
                </div>
                <div className="result-total"><span className="rt-lbl">Total referencial + IVA</span><span className="rt-val">{fmtMoney(qResult.price.total)}</span></div>
                <div style={{marginTop:12}}><button className="btn-orange btn-sm" onClick={() => setView('cotizaciones')}>Crear cotización</button></div>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="card">
            <div className="card-head"><h2>Próximos servicios</h2></div>
            {!upcoming.length && <div className="empty-note">No hay servicios agendados próximamente.</div>}
            {upcoming.map(r => {
              const cam = camiones.find(c => c.id === r.camion_id)
              const d = new Date(r.fecha + 'T00:00:00')
              return (
                <div className="svc-item" key={r.id}>
                  <div className="svc-date"><div className="mo">{MESES[d.getMonth()]}</div><div className="dy">{d.getDate()}</div></div>
                  <div className="svc-body">
                    <div className="t1">{r.cliente}</div>
                    <div className="t2">{cam?.nombre || '—'}</div>
                    <div className="t3">{r.direccion}, {r.comuna}</div>
                  </div>
                  <span className={`svc-tag tag ${r.estado === 'En Trabajo' ? 'st-trabajo' : 'st-reservado'}`}>{r.estado}</span>
                </div>
              )
            })}
          </div>
          <div className="card">
            <div className="card-head"><h2>Alertas</h2></div>
            {!alerts.length && <div className="empty-note">Sin alertas activas.</div>}
            {alerts.map(c => (
              <div className="alert-item" key={c.id}>
                <div className="alert-dot" style={{background: c.estado_general === 'Fuera de Servicio' ? 'var(--purple)' : 'var(--red)'}}></div>
                <div><div className="a-t1">{c.nombre}</div><div className="a-t2">{c.estado_general}{c.hasta ? ' · hasta ' + c.hasta.slice(8,10)+'/'+c.hasta.slice(5,7) : ''}</div></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

// ============================================================
function Camiones({ camiones, isAdmin, toast, reload }) {
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ nombre: '', patente: '', tamano: '13', aislado: 'No' })
  const [rows, setRows] = useState(camiones)
  const [savingId, setSavingId] = useState(null)
  useEffect(() => setRows(camiones), [camiones])

  function editField(id, field, value) {
    setRows(rs => rs.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  async function saveRow(id) {
    const row = rows.find(r => r.id === id)
    if (!row.nombre || !row.patente) { toast('Nombre y patente no pueden quedar vacíos'); return }
    setSavingId(id)
    const patch = {
      nombre: row.nombre, patente: row.patente, tamano: Number(row.tamano), aislado: row.aislado,
      estado_general: row.estado_general, hasta: row.estado_general === 'Operativo' ? null : (row.hasta || null),
    }
    const { error } = await supabase.from('camiones').update(patch).eq('id', id)
    setSavingId(null)
    if (error) { toast('No se pudo guardar (revisa tus permisos)'); return }
    toast('Camión actualizado'); reload()
  }

  async function saveTruck() {
    if (!form.nombre || !form.patente) { toast('Completa nombre y patente'); return }
    const { error } = await supabase.from('camiones').insert({
      nombre: form.nombre, patente: form.patente, tamano: Number(form.tamano), aislado: form.aislado,
    })
    if (error) { toast('No se pudo guardar el camión'); return }
    setShowModal(false); setForm({ nombre: '', patente: '', tamano: '13', aislado: 'No' })
    reload(); toast('Camión agregado')
  }

  async function deleteTruck(c) {
    if (!window.confirm(`¿Eliminar "${c.nombre}"? Esto no se puede deshacer. Sus reservas y cotizaciones pasadas quedarán sin camión asignado.`)) return
    const { error } = await supabase.from('camiones').delete().eq('id', c.id)
    if (error) { toast('No se pudo eliminar el camión'); return }
    toast('Camión eliminado'); reload()
  }

  return (
    <>
      <div className="toolbar">
        <div><h1>Camiones</h1><div className="section-sub">{isAdmin ? 'Edita los datos y presiona Guardar en cada fila' : 'Estado y datos de la flota'}</div></div>
        {isAdmin && <button className="btn-orange" onClick={() => setShowModal(true)}>+ Nuevo camión</button>}
      </div>
      <div className="card" style={{padding:0}}>
        <table className="data">
          <thead><tr><th>Camión</th><th>Patente</th><th>Tamaño</th><th>Aislado</th><th>Estado</th><th>Hasta</th>{isAdmin && <th></th>}</tr></thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id}>
                <td>{isAdmin
                  ? <input type="text" value={c.nombre} onChange={e => editField(c.id, 'nombre', e.target.value)} style={{width:170}} />
                  : <strong>{c.nombre}</strong>}
                </td>
                <td>{isAdmin
                  ? <input type="text" value={c.patente} onChange={e => editField(c.id, 'patente', e.target.value)} style={{width:100}} className="mono" />
                  : <span className="mono">{c.patente}</span>}
                </td>
                <td>{isAdmin ? (
                  <select value={c.tamano} onChange={e => editField(c.id, 'tamano', e.target.value)}>
                    <option value={13}>13 m</option><option value={20}>20 m</option><option value={28}>28 m</option>
                  </select>
                ) : `${c.tamano} m`}</td>
                <td>{isAdmin ? (
                  <select value={c.aislado} onChange={e => editField(c.id, 'aislado', e.target.value)}>
                    <option value="No">No</option><option value="Sí">Sí</option>
                  </select>
                ) : c.aislado}</td>
                <td>
                  {isAdmin ? (
                    <select value={c.estado_general} onChange={e => editField(c.id, 'estado_general', e.target.value)}>
                      <option value="Operativo">Operativo</option>
                      <option value="Mantención">Mantención</option>
                      <option value="Fuera de Servicio">Fuera de Servicio</option>
                    </select>
                  ) : (
                    <span className={`tag ${badgeClassFor(c.estado_general === 'Operativo' ? 'Disponible' : c.estado_general)}`}>{c.estado_general}</span>
                  )}
                </td>
                <td>{isAdmin
                  ? <input type="date" value={c.hasta || ''} disabled={c.estado_general === 'Operativo'} onChange={e => editField(c.id, 'hasta', e.target.value)} style={{width:135}} />
                  : (c.hasta ? new Date(c.hasta+'T00:00:00').toLocaleDateString('es-CL') : '—')}
                </td>
                {isAdmin && <td style={{display:'flex',gap:6}}>
                  <button className="btn-dark btn-sm" disabled={savingId===c.id} onClick={() => saveRow(c.id)}>{savingId===c.id ? 'Guardando…' : 'Guardar'}</button>
                  <button className="btn-danger btn-sm" onClick={() => deleteTruck(c)}>Eliminar</button>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-bg show">
          <div className="modal">
            <h3>Nuevo camión</h3>
            <div className="msub">Se agrega a la flota y aparece de inmediato para todo el equipo.</div>
            <div className="f-group"><label>Nombre / identificador</label><input type="text" value={form.nombre} onChange={e => setForm({...form, nombre: e.target.value})} placeholder="Ej: Camión 13m – N°4" /></div>
            <div className="f-group"><label>Patente</label><input type="text" value={form.patente} onChange={e => setForm({...form, patente: e.target.value})} placeholder="Ej: AB-CD-12" /></div>
            <div className="f-group"><label>Tamaño</label>
              <select value={form.tamano} onChange={e => setForm({...form, tamano: e.target.value})}>
                <option value="13">13 metros</option><option value="20">20 metros</option><option value="28">28 metros</option>
              </select>
            </div>
            <div className="f-group"><label>¿Aislado?</label>
              <select value={form.aislado} onChange={e => setForm({...form, aislado: e.target.value})}>
                <option value="No">No</option><option value="Sí">Sí</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn-outline" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn-orange" onClick={saveTruck}>Guardar camión</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ============================================================
function Conductores({ conductores, isAdmin, toast, reload }) {
  const [rows, setRows] = useState(conductores)
  const [savingId, setSavingId] = useState(null)
  const [nuevo, setNuevo] = useState({ nombre: '', telefono: '' })
  useEffect(() => setRows(conductores), [conductores])

  function editField(id, field, value) {
    setRows(rs => rs.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  async function saveRow(id) {
    const row = rows.find(r => r.id === id)
    if (!row.nombre) { toast('El nombre no puede quedar vacío'); return }
    setSavingId(id)
    const { error } = await supabase.from('conductores').update({ nombre: row.nombre, telefono: row.telefono || null }).eq('id', id)
    setSavingId(null)
    if (error) { toast('No se pudo guardar'); return }
    toast('Conductor actualizado'); reload()
  }

  async function addConductor() {
    if (!nuevo.nombre.trim()) { toast('Escribe el nombre del conductor'); return }
    const { error } = await supabase.from('conductores').insert({ nombre: nuevo.nombre.trim(), telefono: nuevo.telefono.trim() || null })
    if (error) { toast('No se pudo agregar el conductor'); return }
    setNuevo({ nombre: '', telefono: '' })
    reload(); toast('Conductor agregado')
  }

  async function deleteConductor(c) {
    if (!window.confirm(`¿Eliminar a "${c.nombre}" de la lista de conductores? Las reservas que tenía asignadas quedarán sin conductor.`)) return
    const { error } = await supabase.from('conductores').delete().eq('id', c.id)
    if (error) { toast('No se pudo eliminar'); return }
    toast('Conductor eliminado'); reload()
  }

  return (
    <>
      <div className="toolbar">
        <div><h1>Conductores</h1><div className="section-sub">{isAdmin ? 'Edita los datos y presiona Guardar en cada fila' : 'Conductores disponibles para asignar a una reserva'}</div></div>
      </div>
      <div className="card" style={{padding:0}}>
        <table className="data">
          <thead><tr><th>Nombre</th><th>Teléfono</th>{isAdmin && <th></th>}</tr></thead>
          <tbody>
            {!rows.length && <tr><td colSpan={3} style={{textAlign:'center',color:'var(--mute2)',padding:24}}>Aún no hay conductores cargados.</td></tr>}
            {rows.map(c => (
              <tr key={c.id}>
                <td>{isAdmin
                  ? <input type="text" value={c.nombre} onChange={e => editField(c.id, 'nombre', e.target.value)} style={{width:200}} />
                  : <strong>{c.nombre}</strong>}
                </td>
                <td>{isAdmin
                  ? <input type="text" value={c.telefono || ''} onChange={e => editField(c.id, 'telefono', e.target.value)} placeholder="+56 9 ..." style={{width:150}} />
                  : (c.telefono || '—')}
                </td>
                {isAdmin && <td style={{display:'flex',gap:6}}>
                  <button className="btn-dark btn-sm" disabled={savingId===c.id} onClick={() => saveRow(c.id)}>{savingId===c.id ? 'Guardando…' : 'Guardar'}</button>
                  <button className="btn-danger btn-sm" onClick={() => deleteConductor(c)}>Eliminar</button>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
        {isAdmin && (
          <div style={{padding:16,borderTop:'1px solid var(--border)'}}>
            <div className="section-sub" style={{margin:'0 0 10px'}}>Agregar un conductor nuevo</div>
            <div className="quick-row" style={{gridTemplateColumns:'1.3fr 1fr auto'}}>
              <div className="f-group"><label>Nombre</label><input type="text" value={nuevo.nombre} onChange={e => setNuevo({...nuevo, nombre: e.target.value})} placeholder="Nombre completo" /></div>
              <div className="f-group"><label>Teléfono</label><input type="text" value={nuevo.telefono} onChange={e => setNuevo({...nuevo, telefono: e.target.value})} placeholder="+56 9 ..." /></div>
              <button className="btn-dark" onClick={addConductor}>Agregar</button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ============================================================
function Reservas({ camiones, reservas, conductores, tarifasComunas, perfil, toast, reload, openReserva, openReservaEdit }) {
  const today = isoDate(new Date())
  const sorted = [...reservas].sort((a, b) => b.fecha.localeCompare(a.fecha))

  async function quickDelete(r) {
    if (!window.confirm(`¿Eliminar la reserva de "${r.cliente}" (${new Date(r.fecha+'T00:00:00').toLocaleDateString('es-CL')})?`)) return
    const { error } = await supabase.from('reservas').delete().eq('id', r.id)
    if (error) { toast('No se pudo eliminar la reserva'); return }
    toast('Reserva eliminada'); reload()
  }

  return (
    <>
      <div className="toolbar">
        <div><h1>Reservas</h1><div className="section-sub">Agenda de servicios por camión · también puedes crear una haciendo clic en un día "Disponible" del calendario en el Dashboard</div></div>
        <button className="btn-orange" onClick={() => openReserva(camiones[0]?.id || '', today)}>+ Nueva reserva</button>
      </div>
      <div className="card" style={{padding:0}}>
        <table className="data">
          <thead><tr><th>Cliente</th><th>Camión</th><th>Fecha</th><th>Hora</th><th>Conductor</th><th>Comuna</th><th>Dirección</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {!sorted.length && <tr><td colSpan={9} style={{textAlign:'center',color:'var(--mute2)',padding:24}}>Aún no hay reservas.</td></tr>}
            {sorted.map(r => {
              const cam = camiones.find(c => c.id === r.camion_id)
              const cond = conductores.find(cd => cd.id === r.conductor_id)
              return (
                <tr key={r.id}>
                  <td><strong>{r.cliente}</strong></td>
                  <td>{cam?.nombre || '—'}</td>
                  <td className="mono">{new Date(r.fecha + 'T00:00:00').toLocaleDateString('es-CL')}</td>
                  <td className="mono">{r.hora ? r.hora.slice(0,5) : '—'}</td>
                  <td>{cond?.nombre || '—'}</td>
                  <td>{r.comuna}</td>
                  <td>{r.direccion}</td>
                  <td><span className={`tag ${badgeClassFor(r.estado)}`}>{r.estado}</span></td>
                  <td style={{display:'flex',gap:6}}>
                    <button className="btn-outline btn-sm" onClick={() => openReservaEdit(r)}>Editar</button>
                    <button className="btn-danger btn-sm" onClick={() => quickDelete(r)}>Eliminar</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

// ============================================================
function ReservaModal({ show, onClose, camiones, tarifasComunas, conductores, perfil, toast, reload, initialCamionId, initialFecha, editReserva }) {
  const today = isoDate(new Date())
  const [form, setForm] = useState({ camionId: '', cliente: '', fecha: today, hora: '', comuna: '', direccion: '', estado: 'Reservado', conductorId: '', descripcion: '' })
  const isEdit = !!editReserva

  useEffect(() => {
    if (!show) return
    if (editReserva) {
      setForm({
        camionId: editReserva.camion_id || camiones[0]?.id || '',
        cliente: editReserva.cliente || '',
        fecha: editReserva.fecha || today,
        hora: editReserva.hora ? editReserva.hora.slice(0,5) : '',
        comuna: editReserva.comuna || tarifasComunas[0]?.comuna || '',
        direccion: editReserva.direccion || '',
        estado: editReserva.estado || 'Reservado',
        conductorId: editReserva.conductor_id || '',
        descripcion: editReserva.descripcion || '',
      })
    } else {
      setForm(f => ({
        ...f,
        camionId: initialCamionId || camiones[0]?.id || '',
        fecha: initialFecha || today,
        hora: '', cliente: '', direccion: '', conductorId: '', descripcion: '',
        comuna: f.comuna || tarifasComunas[0]?.comuna || '',
      }))
    }
  }, [show, initialCamionId, initialFecha, editReserva]) // eslint-disable-line

  if (!show) return null

  async function save() {
    if (!form.cliente || !form.fecha || !form.direccion) { toast('Completa cliente, fecha y dirección'); return }
    const payload = {
      camion_id: form.camionId, cliente: form.cliente, fecha: form.fecha, hora: form.hora || null,
      comuna: form.comuna, direccion: form.direccion, estado: form.estado,
      conductor_id: form.conductorId || null, descripcion: form.descripcion || null,
    }
    const { error } = isEdit
      ? await supabase.from('reservas').update(payload).eq('id', editReserva.id)
      : await supabase.from('reservas').insert({ ...payload, valor: 0, creado_por: perfil.id })
    if (error) { toast('No se pudo guardar la reserva'); return }
    reload(); toast(isEdit ? 'Reserva actualizada' : 'Reserva guardada'); onClose()
  }

  async function remove() {
    if (!isEdit) return
    if (!window.confirm(`¿Eliminar la reserva de "${editReserva.cliente}"?`)) return
    const { error } = await supabase.from('reservas').delete().eq('id', editReserva.id)
    if (error) { toast('No se pudo eliminar la reserva'); return }
    reload(); toast('Reserva eliminada'); onClose()
  }

  const camionSel = camiones.find(c => c.id === form.camionId)

  return (
    <div className="modal-bg show">
      <div className="modal">
        <h3>{isEdit ? 'Editar reserva' : 'Nueva reserva'}</h3>
        <div className="msub">{camionSel ? `${camionSel.nombre} · ${new Date(form.fecha + 'T00:00:00').toLocaleDateString('es-CL')}` : 'Elige un camión disponible en la fecha indicada.'}</div>
        <div className="f-group"><label>Camión</label>
          <select value={form.camionId} onChange={e => setForm({...form, camionId: e.target.value})}>
            {camiones.map(c => <option key={c.id} value={c.id}>{c.nombre} ({c.tamano}m)</option>)}
          </select>
        </div>
        <div className="f-group"><label>Cliente</label><input type="text" value={form.cliente} onChange={e => setForm({...form, cliente: e.target.value})} placeholder="Nombre cliente / empresa" /></div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div className="f-group"><label>Fecha</label><input type="date" value={form.fecha} onChange={e => setForm({...form, fecha: e.target.value})} /></div>
          <div className="f-group"><label>Hora</label><input type="time" value={form.hora} onChange={e => setForm({...form, hora: e.target.value})} /></div>
        </div>
        <div className="f-group"><label>Comuna</label>
          <select value={form.comuna} onChange={e => setForm({...form, comuna: e.target.value})}>
            {tarifasComunas.map(c => <option key={c.id} value={c.comuna}>{c.comuna}</option>)}
          </select>
        </div>
        <div className="f-group"><label>Dirección</label><input type="text" value={form.direccion} onChange={e => setForm({...form, direccion: e.target.value})} placeholder="Calle, número" /></div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div className="f-group"><label>Conductor</label>
            <select value={form.conductorId} onChange={e => setForm({...form, conductorId: e.target.value})}>
              <option value="">Sin asignar</option>
              {conductores.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div className="f-group"><label>Estado</label>
            <select value={form.estado} onChange={e => setForm({...form, estado: e.target.value})}>
              <option value="Reservado">Reservado</option><option value="En Trabajo">En Trabajo</option>
            </select>
          </div>
        </div>
        <div className="f-group"><label>Descripción</label>
          <textarea value={form.descripcion} onChange={e => setForm({...form, descripcion: e.target.value})} placeholder="Detalles del trabajo, notas para el conductor, etc." rows={3} style={{width:'100%',padding:'9px 10px',border:'1px solid var(--border)',borderRadius:7,fontSize:'13.5px',fontFamily:'inherit',resize:'vertical'}} />
        </div>
        <div className="modal-actions">
          {isEdit
            ? <button className="btn-danger" onClick={remove}>Eliminar</button>
            : <button className="btn-outline" onClick={onClose}>Cancelar</button>}
          <button className="btn-orange" onClick={save}>{isEdit ? 'Guardar cambios' : 'Guardar reserva'}</button>
        </div>
        {isEdit && <button className="btn-outline" style={{width:'100%',marginTop:8}} onClick={onClose}>Cancelar</button>}
      </div>
    </div>
  )
}

// ============================================================
function Tarifas({ tarifaArriendo, tarifasComunas, isAdmin, toast, reload }) {
  const [arriendo, setArriendo] = useState(tarifaArriendo)
  const [comunas, setComunas] = useState(tarifasComunas)
  const [filtro, setFiltro] = useState('Todas')
  const [nueva, setNueva] = useState({ comuna: '', p13: '', p20: '', p28: '' })
  useEffect(() => setArriendo(tarifaArriendo), [tarifaArriendo])
  useEffect(() => setComunas(tarifasComunas), [tarifasComunas])

  async function saveAll() {
    const upsertsArriendo = Object.entries(arriendo).map(([tamano, valor]) => ({ tamano: Number(tamano), valor: Number(valor) }))
    const upsertsComunas = comunas.map(c => ({ id: c.id, comuna: c.comuna, p13: Number(c.p13), p20: Number(c.p20), p28: Number(c.p28) }))
    const [r1, r2] = await Promise.all([
      supabase.from('tarifas_arriendo').upsert(upsertsArriendo),
      supabase.from('tarifas_comunas').upsert(upsertsComunas),
    ])
    if (r1.error || r2.error) { toast('No se pudieron guardar las tarifas'); return }
    toast('Tarifas guardadas'); reload()
  }

  async function addComuna() {
    if (!nueva.comuna.trim()) { toast('Escribe el nombre de la comuna'); return }
    const { error } = await supabase.from('tarifas_comunas').insert({
      comuna: nueva.comuna.trim(), p13: Number(nueva.p13)||0, p20: Number(nueva.p20)||0, p28: Number(nueva.p28)||0,
    })
    if (error) { toast('No se pudo agregar (¿ya existe esa comuna?)'); return }
    setNueva({ comuna: '', p13: '', p20: '', p28: '' })
    reload(); toast('Comuna agregada')
  }

  async function deleteComuna(c) {
    if (!window.confirm(`¿Eliminar "${c.comuna}" de la lista de tarifas?`)) return
    const { error } = await supabase.from('tarifas_comunas').delete().eq('id', c.id)
    if (error) { toast('No se pudo eliminar'); return }
    if (filtro === c.comuna) setFiltro('Todas')
    reload(); toast('Comuna eliminada')
  }

  const visibles = filtro === 'Todas' ? comunas : comunas.filter(c => c.comuna === filtro)

  return (
    <>
      <div className="toolbar">
        <div><h1>Tarifas</h1><div className="section-sub">Valores de arriendo y traslado por comuna (referenciales, + IVA)</div></div>
        {isAdmin && <button className="btn-orange" onClick={saveAll}>Guardar cambios</button>}
      </div>
      {!isAdmin && <div className="readonly-note">Solo la administradora puede editar las tarifas. Puedes consultarlas libremente.</div>}
      <div className="card">
        <div className="card-head"><h2>Arriendo por hora (según tamaño)</h2></div>
        <table className="data">
          <thead><tr><th>Tamaño</th><th>Valor por hora</th></tr></thead>
          <tbody>
            {[13, 20, 28].map(sz => (
              <tr key={sz}>
                <td>{sz} metros</td>
                <td>{isAdmin
                  ? <input type="text" inputMode="numeric" value={fmtInputMoney(arriendo[sz])} onChange={e => setArriendo({...arriendo, [sz]: parseMoneyInput(e.target.value)})} />
                  : <span className="mono">{fmtMoney(arriendo[sz])}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isAdmin && <div style={{marginTop:12}}><button className="btn-dark btn-sm" onClick={saveAll}>Guardar arriendo</button></div>}
      </div>
      <div className="card" style={{padding:0}}>
        <div className="card-head" style={{padding:'18px 18px 0'}}>
          <h2>Traslado por comuna</h2>
          <div className="f-group" style={{minWidth:220,marginBottom:0}}>
            <select value={filtro} onChange={e => setFiltro(e.target.value)}>
              <option value="Todas">Ver todas las comunas ({comunas.length})</option>
              {comunas.map(c => <option key={c.id} value={c.comuna}>{c.comuna}</option>)}
            </select>
          </div>
        </div>
        <table className="data">
          <thead><tr><th>Comuna</th><th>13 metros</th><th>20 metros</th><th>28 metros</th>{isAdmin && <th></th>}</tr></thead>
          <tbody>
            {!visibles.length && <tr><td colSpan={5} style={{textAlign:'center',color:'var(--mute2)',padding:20}}>No hay comunas que coincidan.</td></tr>}
            {visibles.map((c) => {
              const i = comunas.findIndex(x => x.id === c.id)
              return (
                <tr key={c.id}>
                  <td><strong>{c.comuna}</strong></td>
                  {['p13', 'p20', 'p28'].map(k => (
                    <td key={k}>{isAdmin
                      ? <input type="text" inputMode="numeric" value={fmtInputMoney(comunas[i][k])} onChange={e => { const cp = [...comunas]; cp[i] = {...cp[i], [k]: parseMoneyInput(e.target.value)}; setComunas(cp) }} />
                      : <span className="mono">{fmtMoney(c[k])}</span>}
                    </td>
                  ))}
                  {isAdmin && <td><button className="btn-danger btn-sm" onClick={() => deleteComuna(c)}>Eliminar</button></td>}
                </tr>
              )
            })}
          </tbody>
        </table>
        {isAdmin && (
          <div style={{padding:16,borderTop:'1px solid var(--border)'}}>
            <div className="section-sub" style={{margin:'0 0 10px'}}>Agregar una comuna nueva a la lista</div>
            <div className="quick-row" style={{gridTemplateColumns:'1.3fr 1fr 1fr 1fr auto'}}>
              <div className="f-group"><label>Comuna</label><input type="text" value={nueva.comuna} onChange={e => setNueva({...nueva, comuna: e.target.value})} placeholder="Nombre de la comuna" /></div>
              <div className="f-group"><label>13 m</label><input type="text" inputMode="numeric" value={nueva.p13 === '' ? '' : fmtInputMoney(nueva.p13)} onChange={e => setNueva({...nueva, p13: parseMoneyInput(e.target.value)})} placeholder="0" /></div>
              <div className="f-group"><label>20 m</label><input type="text" inputMode="numeric" value={nueva.p20 === '' ? '' : fmtInputMoney(nueva.p20)} onChange={e => setNueva({...nueva, p20: parseMoneyInput(e.target.value)})} placeholder="0" /></div>
              <div className="f-group"><label>28 m</label><input type="text" inputMode="numeric" value={nueva.p28 === '' ? '' : fmtInputMoney(nueva.p28)} onChange={e => setNueva({...nueva, p28: parseMoneyInput(e.target.value)})} placeholder="0" /></div>
              <button className="btn-dark" onClick={addComuna}>Agregar</button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ============================================================
function Cotizaciones({ camiones, reservas, cotizaciones, tarifaArriendo, tarifasComunas, perfil, toast, reload }) {
  const today = isoDate(new Date())
  const [cliente, setCliente] = useState('')
  const [size, setSize] = useState('13')
  const [date, setDate] = useState(today)
  const [comuna, setComuna] = useState(tarifasComunas[0]?.comuna || '')
  const [result, setResult] = useState(null)
  useEffect(() => { if (!comuna && tarifasComunas[0]) setComuna(tarifasComunas[0].comuna) }, [tarifasComunas]) // eslint-disable-line

  function build() {
    const truck = findAvailableTruck(camiones, reservas, size, date)
    const price = priceFor(tarifaArriendo, tarifasComunas, size, comuna)
    setResult({ truck, price })
  }

  async function save() {
    if (!result) return
    const { error } = await supabase.from('cotizaciones').insert({
      cliente: cliente || 'Sin nombre', tamano: Number(size), fecha: date, comuna,
      camion_id: result.truck ? result.truck.id : null, total: result.price.total,
      estado: 'Pendiente', creado_por: perfil.id,
    })
    if (error) { toast('No se pudo guardar la cotización'); return }
    setCliente(''); setResult(null); reload(); toast('Cotización guardada')
  }

  async function confirmQuote(q) {
    if (!q.camion_id) { toast('Asigna un camión disponible antes de confirmar'); return }
    const [r1, r2] = await Promise.all([
      supabase.from('cotizaciones').update({ estado: 'Confirmada' }).eq('id', q.id),
      supabase.from('reservas').insert({
        camion_id: q.camion_id, cliente: q.cliente, fecha: q.fecha, comuna: q.comuna,
        direccion: 'Por confirmar', estado: 'Reservado', valor: q.total, creado_por: perfil.id,
      }),
    ])
    if (r1.error || r2.error) { toast('No se pudo confirmar'); return }
    reload(); toast('Reserva creada desde la cotización')
  }

  const sorted = [...cotizaciones].sort((a, b) => (b.creado_en || '').localeCompare(a.creado_en || ''))

  return (
    <>
      <div className="toolbar"><div><h1>Cotizaciones</h1><div className="section-sub">Arma una cotización y guárdala para hacer seguimiento</div></div></div>
      <div className="card">
        <div className="card-head"><h2>Nueva cotización</h2></div>
        <div className="quick-row" style={{gridTemplateColumns:'1fr 1fr 1fr 1fr'}}>
          <div className="f-group"><label>Cliente</label><input type="text" value={cliente} onChange={e => setCliente(e.target.value)} placeholder="Nombre cliente / empresa" /></div>
          <div className="f-group"><label>Tamaño de camión</label>
            <select value={size} onChange={e => setSize(e.target.value)}>
              <option value="13">13 metros</option><option value="20">20 metros</option><option value="28">28 metros</option>
            </select>
          </div>
          <div className="f-group"><label>Fecha</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div className="f-group"><label>Comuna / destino</label>
            <select value={comuna} onChange={e => setComuna(e.target.value)}>
              {tarifasComunas.map(c => <option key={c.id} value={c.comuna}>{c.comuna}</option>)}
            </select>
          </div>
        </div>
        <div style={{marginTop:12}}><button className="btn-dark" onClick={build}>Calcular cotización</button></div>
        {result && !result.truck && (
          <div className="result-box none">
            <div className="result-title no"><span className="ok-ic">×</span>No hay camión de {size}m libre ese día</div>
            <div style={{fontSize:12.5,color:'var(--mute)'}}>Puedes guardar igual la cotización y confirmar el camión más adelante.</div>
            <div style={{marginTop:12}}><button className="btn-outline btn-sm" onClick={save}>Guardar cotización de todas formas</button></div>
          </div>
        )}
        {result && result.truck && (
          <div className="result-box">
            <div className="result-title"><span className="ok-ic">✓</span>{result.truck.nombre} · {size}m</div>
            <div className="result-grid">
              <div className="rl">Cliente</div><div className="rv">{cliente || '—'}</div>
              <div className="rl">Arriendo (por hora)</div><div className="rv">{fmtMoney(result.price.arriendo)}</div>
              <div className="rl">Traslado a {comuna}</div><div className="rv">{fmtMoney(result.price.traslado)}</div>
            </div>
            <div className="result-total"><span className="rt-lbl">Total + IVA</span><span className="rt-val">{fmtMoney(result.price.total)}</span></div>
            <div style={{marginTop:12}}><button className="btn-orange btn-sm" onClick={save}>Guardar cotización</button></div>
          </div>
        )}
      </div>
      <div className="card" style={{padding:0}}>
        <div className="card-head" style={{padding:'18px 18px 0'}}><h2>Cotizaciones guardadas</h2></div>
        <table className="data">
          <thead><tr><th>Cliente</th><th>Camión</th><th>Fecha</th><th>Comuna</th><th>Total</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {!sorted.length && <tr><td colSpan={7} style={{textAlign:'center',color:'var(--mute2)',padding:24}}>Aún no hay cotizaciones guardadas.</td></tr>}
            {sorted.map(q => {
              const cam = camiones.find(c => c.id === q.camion_id)
              return (
                <tr key={q.id}>
                  <td><strong>{q.cliente}</strong></td>
                  <td>{q.tamano}m {cam ? '· ' + cam.nombre : ''}</td>
                  <td className="mono">{new Date(q.fecha + 'T00:00:00').toLocaleDateString('es-CL')}</td>
                  <td>{q.comuna}</td>
                  <td className="mono"><strong>{fmtMoney(q.total)}</strong></td>
                  <td><span className={`tag ${q.estado === 'Confirmada' ? 'st-trabajo' : 'st-pendiente'}`}>{q.estado}</span></td>
                  <td>{q.estado === 'Pendiente' && <button className="btn-dark btn-sm" onClick={() => confirmQuote(q)}>Confirmar y reservar</button>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
