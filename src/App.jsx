import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from './supabaseClient'
import Login from './Login.jsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  isoDate, startOfWorkWeek, addDays, fmtMoney, fmtInputMoney, parseMoneyInput, DIAS, MESES,
  badgeClassFor, camionEstadoEnFecha, findAvailableTruck, priceFor,
} from './helpers.js'

const Mark = () => (
  <div className="mark-plate"><img src="/logo.png" alt="Ilumsa" className="mark-img" /></div>
)

// Evita que el modal se cierre y borre lo escrito cuando el usuario hace click y arrastra
// (por ejemplo, seleccionando texto) desde dentro del modal hacia afuera: solo cierra si el
// mousedown Y el click ocurrieron ambos directamente sobre el fondo, no sobre el contenido.
// Encabezado corto de días para la grilla mensual del Historial (empieza en lunes).
const DIAS_SEMANA_CORTOS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

// Medianoche de hoy, para usar como inicio de la ventana visible del calendario (así el día
// de hoy queda como primera columna, sin tener que desplazarse hacia los lados para verlo).
function todayMidnight() { const d = new Date(); d.setHours(0, 0, 0, 0); return d }

function overlayMouseDown(e) { if (e.target === e.currentTarget) e.currentTarget.dataset.downBg = '1' }
function overlayClick(e, closeFn) {
  const wasDownOnBg = e.currentTarget.dataset.downBg === '1'
  e.currentTarget.dataset.downBg = ''
  if (wasDownOnBg && e.target === e.currentTarget) closeFn()
}

// Sugerencias para "Tipo de trabajo" en el formulario de reservas — el campo queda libre
// para escribir cualquier cosa, esto solo ayuda a elegir rápido los más comunes.
const TIPOS_TRABAJO = [
  'Poda de árboles',
  'Trabajo eléctrico',
  'Telecomunicaciones',
  'Trabajo en altura / fachada',
]

// Iconos de navegación en SVG (más confiables entre navegadores que los emoji/símbolos unicode)
const NavIcons = {
  dashboard: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>,
  camiones: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 16V6a1 1 0 0 1 1-1h9v11"/><path d="M13 9h4l4 4v3h-8"/><circle cx="7.5" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/></svg>,
  reservas: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 3v3M16 3v3"/></svg>,
  tarifas: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M15 9.5c0-1.1-1.34-2-3-2s-3 .9-3 2 1.34 1.6 3 2 3 .9 3 2-1.34 2-3 2-3-.9-3-2M12 6v2M12 16v2"/></svg>,
  cotizaciones: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M9 12h6M9 16h6M9 8h3"/></svg>,
  conductores: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.9 3.13-7 7-7s7 3.1 7 7"/></svg>,
  clientes: <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="7" r="2.4"/><path d="M15.5 13.2c2.5.4 4.5 2.5 4.5 5.3"/></svg>,
}

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = cargando, null = sin sesión
  const [perfil, setPerfil] = useState(null)
  const [view, setView] = useState('dashboard')
  const [toastMsg, setToastMsg] = useState('')
  const [calWeekStart, setCalWeekStart] = useState(startOfWorkWeek(new Date()))
  const [reservaModal, setReservaModal] = useState({ show: false, camionId: '', fecha: '', editReserva: null, prefill: null })
  const [confirmState, setConfirmState] = useState(null)
  // Menú lateral en celular: en pantallas angostas el menú queda oculto fuera de la pantalla y
  // se abre con el botón ☰ (no afecta nada del formato de escritorio, solo aplica bajo cierto
  // ancho de pantalla vía CSS).
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const [camiones, setCamiones] = useState([])
  const [reservas, setReservas] = useState([])
  const [cotizaciones, setCotizaciones] = useState([])
  const [conductores, setConductores] = useState([])
  const [clientes, setClientes] = useState([])
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
    const [c, r, q, ta, tc, cd, cl] = await Promise.all([
      supabase.from('camiones').select('*').order('nombre'),
      supabase.from('reservas').select('*'),
      supabase.from('cotizaciones').select('*'),
      supabase.from('tarifas_arriendo').select('*'),
      supabase.from('tarifas_comunas').select('*').order('comuna'),
      supabase.from('conductores').select('*').order('nombre'),
      supabase.from('clientes').select('*').order('nombre'),
    ])
    if (c.data) setCamiones(c.data)
    if (r.data) setReservas(r.data)
    if (q.data) setCotizaciones(q.data)
    if (ta.data) setTarifaArriendo(Object.fromEntries(ta.data.map(x => [x.tamano, x.valor])))
    if (tc.data) setTarifasComunas(tc.data)
    if (cd.data) setConductores(cd.data)
    if (cl.data) setClientes(cl.data)
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, loadAll)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [perfil, loadAll])

  function toast(msg) { setToastMsg(msg); setTimeout(() => setToastMsg(''), 2400) }
  // Reemplaza a window.confirm() por un cuadro propio, con el mismo estilo que el resto de la
  // app — se usa igual que window.confirm pero es async: `if (!(await confirmDialog('¿Seguro?'))) return`
  function confirmDialog(message, opts = {}) {
    return new Promise(resolve => setConfirmState({ message, resolve, ...opts }))
  }
  function resolveConfirm(result) {
    if (confirmState) confirmState.resolve(result)
    setConfirmState(null)
  }
  function openReserva(camionId, fecha) { setReservaModal({ show: true, camionId, fecha, editReserva: null, prefill: null }) }
  function openReservaEdit(reserva) { setReservaModal({ show: true, camionId: reserva.camion_id, fecha: reserva.fecha, editReserva: reserva, prefill: null }) }
  // Abre el formulario de "Nueva reserva" ya precargado con los datos de una cotización recién
  // confirmada (empresa, contacto, comuna). El camión queda sugerido según el tamaño cotizado
  // (si hay uno disponible hoy), pero siempre hay que confirmarlo/elegirlo antes de guardar.
  function openReservaDraft(prefill) {
    const hoy = isoDate(new Date())
    const tamano = prefill?.tamano ? Number(prefill.tamano) : null
    const sugerido = tamano ? camiones.find(c => c.tamano === tamano && camionEstadoEnFecha(c, hoy, reservas) === 'Disponible') : null
    setReservaModal({ show: true, camionId: sugerido?.id || '', fecha: hoy, editReserva: null, prefill })
  }
  function closeReserva() { setReservaModal(m => ({ ...m, show: false })) }

  if (session === undefined) return <div className="loading-screen">Cargando…</div>
  if (!session) return <Login />
  if (!perfil) return <div className="loading-screen">Preparando tu cuenta… si esto no cambia, pide a la administradora que confirme tu perfil en Supabase.</div>

  const isAdmin = perfil.rol === 'Administradora'

  return (
    <div id="app" className="show">
      <button className="mobile-menu-btn" onClick={() => setMobileNavOpen(true)} aria-label="Abrir menú">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
      </button>
      <div className={`mobile-overlay ${mobileNavOpen ? 'show' : ''}`} onClick={() => setMobileNavOpen(false)}></div>
      <Sidebar perfil={perfil} view={view} setView={setView} mobileOpen={mobileNavOpen} onNavigate={() => setMobileNavOpen(false)} />
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
          <Camiones camiones={camiones} isAdmin={isAdmin} toast={toast} reload={loadAll} confirm={confirmDialog} />
        )}
        {view === 'reservas' && (
          <Reservas
            camiones={camiones} reservas={reservas} conductores={conductores} tarifasComunas={tarifasComunas}
            perfil={perfil} toast={toast} reload={loadAll} openReserva={openReserva} openReservaEdit={openReservaEdit}
            confirm={confirmDialog}
          />
        )}
        {view === 'conductores' && (
          <Conductores conductores={conductores} isAdmin={isAdmin} toast={toast} reload={loadAll} confirm={confirmDialog} />
        )}
        {view === 'clientes' && (
          <Clientes clientes={clientes} toast={toast} reload={loadAll} confirm={confirmDialog} />
        )}
        {view === 'tarifas' && (
          <Tarifas
            tarifaArriendo={tarifaArriendo} tarifasComunas={tarifasComunas}
            isAdmin={isAdmin} toast={toast} reload={loadAll} confirm={confirmDialog}
          />
        )}
        {view === 'cotizaciones' && (
          <Cotizaciones cotizaciones={cotizaciones} tarifasComunas={tarifasComunas} tarifaArriendo={tarifaArriendo} clientes={clientes} perfil={perfil} toast={toast} reload={loadAll} confirm={confirmDialog} openReservaDraft={openReservaDraft} />
        )}
      </main>
      <ReservaModal
        show={reservaModal.show} onClose={closeReserva}
        camiones={camiones} tarifasComunas={tarifasComunas} conductores={conductores} clientes={clientes}
        perfil={perfil} toast={toast} reload={loadAll} confirm={confirmDialog}
        initialCamionId={reservaModal.camionId} initialFecha={reservaModal.fecha} editReserva={reservaModal.editReserva} initialPrefill={reservaModal.prefill}
      />
      <ConfirmModal state={confirmState} onResult={resolveConfirm} />
      <div className={`toast ${toastMsg ? 'show' : ''}`}>{toastMsg}</div>
    </div>
  )
}

// Reemplazo propio de window.confirm() / window.alert(), con el mismo estilo visual que el
// resto de los cuadros de la app (en vez del cuadro genérico y feo del navegador).
function ConfirmModal({ state, onResult }) {
  useEffect(() => {
    if (!state) return
    function onKey(e) { if (e.key === 'Escape') onResult(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state]) // eslint-disable-line

  if (!state) return null
  return (
    <div className="modal-bg show" onMouseDown={overlayMouseDown} onClick={e => overlayClick(e, () => onResult(false))}>
      <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
        <div className="confirm-icon">{state.danger === false ? 'i' : '!'}</div>
        <div className="confirm-msg">{state.message}</div>
        <div className="modal-actions">
          <button className="btn-outline" onClick={() => onResult(false)}>{state.cancelLabel || 'Cancelar'}</button>
          <button className={state.danger === false ? 'btn-orange' : 'btn-danger'} onClick={() => onResult(true)}>{state.okLabel || 'Aceptar'}</button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
function Sidebar({ perfil, view, setView, mobileOpen, onNavigate }) {
  const items = [
    ['dashboard', 'dashboard', 'Dashboard'],
    ['camiones', 'camiones', 'Camiones'],
    ['reservas', 'reservas', 'Reservas'],
    ['conductores', 'conductores', 'Conductores'],
    ['clientes', 'clientes', 'Clientes'],
    ['tarifas', 'tarifas', 'Tarifas'],
    ['cotizaciones', 'cotizaciones', 'Cotizaciones'],
  ]
  return (
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      <button className="mobile-close-btn" onClick={onNavigate} aria-label="Cerrar menú">×</button>
      <div className="brand">
        <Mark />
        <div className="sub">ALZA HOMBRES</div>
      </div>
      <nav className="nav-group">
        {items.map(([key, icKey, label]) => (
          <button key={key} className={`nav-item ${view === key ? 'active' : ''}`} onClick={() => { setView(key); onNavigate && onNavigate() }}>
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
    else if (est === 'Reservado' || est === 'En Trabajo' || est === 'Pendiente') ocup++
    else if (est === 'Mantención' || est === 'Fuera de Servicio') mant++
  })
  const manana = reservas.filter(r => r.fecha === tomorrow).length
  const cotPend = cotizaciones.filter(c => c.estado === 'Pendiente').length

  const days = [...Array(7)].map((_, i) => addDays(calWeekStart, i)) // Lun–Dom

  const [qSize, setQSize] = useState('13')
  const [qDate, setQDate] = useState(today)
  const [qComuna, setQComuna] = useState('')
  const [qResult, setQResult] = useState(null)

  function runSearch() {
    // Muestra TODOS los camiones disponibles de ese tamaño ese día, no solo el primero.
    const trucks = camiones.filter(c => c.tamano === Number(qSize) && camionEstadoEnFecha(c, qDate, reservas) === 'Disponible')
    if (!trucks.length) { setQResult({ ok: false }); return }
    const price = priceFor(tarifaArriendo, tarifasComunas, qSize, qComuna)
    setQResult({ ok: true, trucks, price })
  }

  const upcoming = reservas.filter(r => r.fecha >= today).sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(0, 5)
  const alerts = camiones.filter(c => c.estado_general === 'Mantención' || c.estado_general === 'Fuera de Servicio')
  const [expandedSvc, setExpandedSvc] = useState(null)
  const [showHistorial, setShowHistorial] = useState(false)

  // La semana se sigue mostrando completa (Lun–Dom, incluye días pasados), pero cada vez que
  // cambia la semana visible desplazamos el scroll horizontal para que la columna de hoy quede
  // pegada a la izquierda — así no hay que arrastrar hacia los lados para verla.
  const todayColRef = useRef(null)
  useEffect(() => {
    const el = todayColRef.current
    const wrap = el?.closest('.cal-wrap')
    if (!el || !wrap) return
    // La primera columna (nombre del camión) queda fija a la izquierda (sticky), así que no
    // basta con "scrollIntoView" — hay que dejar la columna de hoy pegada justo después de esa
    // columna fija, no debajo de ella.
    const stickyCol = wrap.querySelector('th:first-child')
    const stickyWidth = stickyCol ? stickyCol.getBoundingClientRect().width : 0
    const delta = el.getBoundingClientRect().left - wrap.getBoundingClientRect().left - stickyWidth
    wrap.scrollLeft += delta
  }, [calWeekStart])

  return (
    <>
      <div className="topbar">
        <div>
          <h1>{perfil.rol === 'Administradora' ? 'Bienvenida' : 'Bienvenido'}, {perfil.nombre}</h1>
          <div className="greet">{perfil.rol}</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div className="pill live"><span className="dot"></span> {new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <button className="btn-outline btn-sm" onClick={() => setShowHistorial(true)} title="Ver historial de arriendos por mes">Historial</button>
        </div>
        <HistorialModal show={showHistorial} onClose={() => setShowHistorial(false)} reservas={reservas} camiones={camiones} openReservaEdit={openReservaEdit} />
      </div>

      <div className="stats-row">
        <div className="stat-card green"><div className="lbl">Camiones disponibles hoy</div><div className="val">{disp}</div><div className="of">de {total}</div></div>
        <div className="stat-card amber"><div className="lbl">Camiones ocupados hoy</div><div className="val">{ocup}</div><div className="of">de {total}</div></div>
        <div className="stat-card red"><div className="lbl">En mantención</div><div className="val">{mant}</div><div className="of">de {total}</div></div>
        <div className="stat-card blue"><div className="lbl">Servicios mañana</div><div className="val">{manana}</div><div className="of">reservas</div></div>
      </div>

      <div className="grid-2col">
        <div>
          <div className="card">
            <div className="card-head">
              <h2>Calendario de camiones</h2>
              <div className="week-nav">
                <button onClick={() => setCalWeekStart(addDays(calWeekStart, -7))} title="Ver la semana anterior">‹</button>
                <span className="range">{days[0].getDate()} – {days[6].getDate()} de {MESES[days[6].getMonth()].charAt(0) + MESES[days[6].getMonth()].slice(1).toLowerCase()}, {days[6].getFullYear()}</span>
                <button onClick={() => setCalWeekStart(addDays(calWeekStart, 7))}>›</button>
                <button className="today-btn" onClick={() => setCalWeekStart(startOfWorkWeek(new Date()))}>Hoy</button>
              </div>
            </div>
            <div className="cal-wrap">
              <table className="calendar">
                <thead><tr><th>Camión</th>{days.map(d => {
                  const dIso = isoDate(d)
                  return <th key={+d} ref={dIso === today ? todayColRef : null}>{DIAS[d.getDay()]} {d.getDate()}{dIso === today && <span className="today-dot" title="Hoy"></span>}</th>
                })}</tr></thead>
                <tbody>
                  {camiones.map(c => (
                    <tr key={c.id}>
                      <td className="truck-cell">
                        <div className="tname">{c.nombre}</div>
                        <div className="tpat">Patente: {c.patente}</div>
                      </td>
                      {days.map(d => {
                        const dIso = isoDate(d)
                        const est = camionEstadoEnFecha(c, dIso, reservas)
                        const cls = est === 'Pendiente' ? 'st-pendiente' : badgeClassFor(est)
                        if (est === 'Reservado' || est === 'En Trabajo' || est === 'Pendiente') {
                          const r = reservas.find(rr => rr.camion_id === c.id && rr.fecha === dIso)
                          return (
                            <td key={+d}>
                              <div
                                className={`badge small-info ${cls} badge-clickable`}
                                title={`${r?.empresa || r?.cliente || ''} · clic para ver / editar esta reserva`}
                                onClick={() => r && openReservaEdit(r)}
                              >{est}<span className="b-sub">{r?.empresa || r?.cliente}</span></div>
                            </td>
                          )
                        }
                        if (est === 'Mantención' || est === 'Fuera de Servicio') {
                          return <td key={+d}><div className={`badge small-info ${cls}`}>{est}<span className="b-sub">{est === 'Mantención' && c.hasta ? 'Hasta ' + c.hasta.slice(8,10)+'/'+c.hasta.slice(5,7) : ''}</span></div></td>
                        }
                        if (dIso < today) {
                          return <td key={+d}><div className={`badge ${cls}`} style={{opacity:.5,cursor:'default'}} title="No se puede agendar en un día anterior">{est}</div></td>
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
              <span><i style={{background:'var(--gray)'}}></i>Pendiente</span>
              <span><i style={{background:'var(--red)'}}></i>En mantención</span>
              <span><i style={{background:'var(--purple)'}}></i>Fuera de servicio</span>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Disponibilidad rápida</h2></div>
            <div className="quick-row">
              <div className="f-group"><label>Tamaño de camión</label>
                <select value={qSize} onChange={e => setQSize(e.target.value)}>
                  <option value="13">13 metros</option><option value="18">18 metros</option><option value="20">20 metros</option>
                </select>
              </div>
              <div className="f-group"><label>Fecha</label><input type="date" value={qDate} onChange={e => setQDate(e.target.value)} /></div>
              <div className="f-group"><label>Comuna / destino</label>
                <input type="text" list="dl-comunas-dash" value={qComuna} onChange={e => setQComuna(e.target.value)} placeholder="Escribe para buscar…" autoComplete="off" />
                <datalist id="dl-comunas-dash">
                  {tarifasComunas.map(c => <option key={c.id} value={c.comuna} />)}
                </datalist>
              </div>
              <button className="btn-dark" onClick={runSearch}>Buscar disponibilidad</button>
            </div>
            {qResult && !qResult.ok && (
              <div className="result-box none"><div className="result-title no"><span className="ok-ic">×</span>Sin camiones de {qSize}m disponibles ese día</div></div>
            )}
            {qResult && qResult.ok && (
              <div className="result-box">
                <div className="result-title"><span className="ok-ic">✓</span>{qResult.trucks.length} camión{qResult.trucks.length === 1 ? '' : 'es'} de {qSize}m disponible{qResult.trucks.length === 1 ? '' : 's'}</div>
                <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:10}}>
                  {qResult.trucks.map(t => (
                    <div key={t.id} style={{display:'flex',justifyContent:'space-between',fontSize:'12.5px'}}>
                      <span><strong>{t.nombre}</strong></span>
                      <span className="mono" style={{color:'var(--mute)'}}>{t.patente}</span>
                    </div>
                  ))}
                </div>
                <div className="result-grid">
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
              const isOpen = expandedSvc === r.id
              return (
                <div className="svc-item svc-clickable" key={r.id} onClick={() => setExpandedSvc(isOpen ? null : r.id)} title="Clic para ver todos los detalles">
                  <div className="svc-date"><div className="mo">{MESES[d.getMonth()]}</div><div className="dy">{d.getDate()}</div></div>
                  <div className="svc-body">
                    <div className="t1">{r.empresa || r.cliente}</div>
                    <div className="t2">{cam?.nombre || '—'}</div>
                    {isOpen && (
                      <div className="svc-detail">
                        {r.empresa && r.cliente && <div className="t3">Cliente: {r.cliente}</div>}
                        {r.contacto && <div className="t3">Contacto: {r.contacto}</div>}
                        {r.tipo_trabajo && <div className="t3">{r.tipo_trabajo}</div>}
                        <div className="t3">{r.direccion}{r.comuna ? ', ' + r.comuna : ''}</div>
                        {r.hora && <div className="t3">Hora: {r.hora.slice(0,5)}</div>}
                        {r.descripcion && <div className="t3">{r.descripcion}</div>}
                      </div>
                    )}
                  </div>
                  <span className={`svc-tag tag ${r.estado === 'En Trabajo' ? 'st-trabajo' : r.estado === 'Pendiente' ? 'st-pendiente' : 'st-reservado'}`}>{r.estado}</span>
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
// Historial de arriendos: calendario mensual para consultar rápido qué empresa arrendó en
// una fecha pasada (por ejemplo "a principios de mes"). Es de solo lectura — a diferencia del
// calendario semanal del dashboard, aquí sí se puede navegar libremente a meses anteriores.
function HistorialModal({ show, onClose, reservas, camiones, openReservaEdit }) {
  const [mes, setMes] = useState(() => todayMidnight())
  const [diaSel, setDiaSel] = useState(null)

  useEffect(() => {
    if (show) { setMes(todayMidnight()); setDiaSel(null) }
  }, [show])

  useEffect(() => {
    if (!show) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [show]) // eslint-disable-line

  if (!show) return null

  const year = mes.getFullYear(), month = mes.getMonth()
  const firstOfMonth = new Date(year, month, 1)
  const offset = (firstOfMonth.getDay() + 6) % 7 // 0 = lunes
  const gridStart = addDays(firstOfMonth, -offset)
  const celdas = [...Array(42)].map((_, i) => addDays(gridStart, i))

  const today = isoDate(new Date())
  const porDia = {}
  reservas.forEach(r => { (porDia[r.fecha] = porDia[r.fecha] || []).push(r) })

  const reservasDelDia = diaSel ? (porDia[diaSel] || []) : []

  return (
    <div className="modal-bg show" onMouseDown={overlayMouseDown} onClick={e => overlayClick(e, onClose)}>
      <div className="modal" style={{maxWidth:560}} onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Cerrar">×</button>
        <h3>Historial de arriendos</h3>
        <div className="msub">Consulta qué empresa arrendó en un día pasado.</div>
        <div className="week-nav" style={{justifyContent:'center',marginBottom:10}}>
          <button onClick={() => { setMes(new Date(year, month - 1, 1)); setDiaSel(null) }}>‹</button>
          <span className="range" style={{minWidth:170}}>{MESES[month].charAt(0) + MESES[month].slice(1).toLowerCase()} {year}</span>
          <button onClick={() => { setMes(new Date(year, month + 1, 1)); setDiaSel(null) }}>›</button>
          <button className="today-btn" onClick={() => { setMes(todayMidnight()); setDiaSel(null) }}>Hoy</button>
        </div>
        <div className="hist-grid">
          {DIAS_SEMANA_CORTOS.map(d => <div key={d} className="hist-dow">{d}</div>)}
          {celdas.map((d, i) => {
            const dIso = isoDate(d)
            const enMes = d.getMonth() === month
            const items = porDia[dIso] || []
            return (
              <div
                key={i}
                className={`hist-cell is-clickable ${enMes ? '' : 'muted'} ${dIso === today ? 'is-today' : ''} ${diaSel === dIso ? 'is-sel' : ''} ${items.length ? 'has-items' : ''}`}
                onClick={() => setDiaSel(dIso === diaSel ? null : dIso)}
              >
                <div className="hist-daynum">{d.getDate()}</div>
                {items.length > 0 && <div className="hist-dot"></div>}
              </div>
            )
          })}
        </div>
        {diaSel && (
          <div className="hist-detail">
            <div className="hist-detail-title">{new Date(diaSel + 'T00:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            {!reservasDelDia.length && <div className="empty-note">Sin arriendos ese día.</div>}
            {reservasDelDia.map(r => {
              const cam = camiones.find(c => c.id === r.camion_id)
              return (
                <div key={r.id} className="hist-item" onClick={() => { onClose(); openReservaEdit && openReservaEdit(r) }} title="Clic para ver el detalle de esta reserva">
                  <div className="t1">{r.empresa || r.cliente}</div>
                  <div className="t2">{cam?.nombre || '—'} · {r.estado}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================
function Camiones({ camiones, isAdmin, toast, reload, confirm }) {
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ nombre: '', patente: '', tamano: '13', aislado: 'No' })
  const [rows, setRows] = useState(camiones)
  const [savingId, setSavingId] = useState(null)
  useEffect(() => setRows(camiones), [camiones])
  useEffect(() => {
    if (!showModal) return
    function onKey(e) { if (e.key === 'Escape') setShowModal(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showModal])

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
    if (error) { console.error('camiones.update', error); toast('No se pudo guardar: ' + (error.message || error.code || 'revisa tus permisos')); return }
    toast('Camión actualizado'); reload()
  }

  async function saveTruck() {
    if (!form.nombre || !form.patente) { toast('Completa nombre y patente'); return }
    const { error } = await supabase.from('camiones').insert({
      nombre: form.nombre, patente: form.patente, tamano: Number(form.tamano), aislado: form.aislado,
    })
    if (error) { console.error('camiones.insert', error); toast('No se pudo guardar el camión: ' + (error.message || error.code || '')); return }
    setShowModal(false); setForm({ nombre: '', patente: '', tamano: '13', aislado: 'No' })
    reload(); toast('Camión agregado')
  }

  async function deleteTruck(c) {
    if (!(await confirm(`¿Eliminar "${c.nombre}"? Esto no se puede deshacer. Sus reservas y cotizaciones pasadas quedarán sin camión asignado.`))) return
    const { error } = await supabase.from('camiones').delete().eq('id', c.id)
    if (error) { console.error('camiones.delete', error); toast('No se pudo eliminar el camión: ' + (error.message || error.code || '')); return }
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
                    <option value={13}>13 m</option><option value={18}>18 m</option><option value={20}>20 m</option>
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
        <div className="modal-bg show" onMouseDown={overlayMouseDown} onClick={e => overlayClick(e, () => setShowModal(false))}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowModal(false)} aria-label="Cerrar">×</button>
            <h3>Nuevo camión</h3>
            <div className="msub">Se agrega a la flota y aparece de inmediato para todo el equipo.</div>
            <div className="f-group"><label>Nombre / identificador</label><input type="text" value={form.nombre} onChange={e => setForm({...form, nombre: e.target.value})} placeholder="Ej: Camión 13m – N°4" /></div>
            <div className="f-group"><label>Patente</label><input type="text" value={form.patente} onChange={e => setForm({...form, patente: e.target.value})} placeholder="Ej: AB-CD-12" /></div>
            <div className="f-group"><label>Tamaño</label>
              <select value={form.tamano} onChange={e => setForm({...form, tamano: e.target.value})}>
                <option value="13">13 metros</option><option value="18">18 metros</option><option value="20">20 metros</option>
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
function Conductores({ conductores, isAdmin, toast, reload, confirm }) {
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
    if (!(await confirm(`¿Eliminar a "${c.nombre}" de la lista de conductores? Las reservas que tenía asignadas quedarán sin conductor.`))) return
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
// Base de clientes: cualquiera del equipo puede agregar/editar (no solo la administradora),
// porque son quienes cotizan día a día y necesitan sumar clientes nuevos sobre la marcha.
// Además, cada vez que se guarda una cotización, el cliente queda registrado aquí solo.
function Clientes({ clientes, toast, reload, confirm }) {
  const [rows, setRows] = useState(clientes)
  const [savingId, setSavingId] = useState(null)
  const [busca, setBusca] = useState('')
  const [nuevo, setNuevo] = useState({ empresa: '', nombre: '', rut: '', direccion: '', correo: '', telefono: '' })
  useEffect(() => setRows(clientes), [clientes])

  function editField(id, field, value) {
    setRows(rs => rs.map(r => r.id === id ? { ...r, [field]: value } : r))
  }

  async function saveRow(id) {
    const row = rows.find(r => r.id === id)
    if (!row.nombre.trim()) { toast('El nombre no puede quedar vacío'); return }
    setSavingId(id)
    const { error } = await supabase.from('clientes').update({
      empresa: row.empresa || null, nombre: row.nombre.trim(), rut: row.rut || null, direccion: row.direccion || null,
      correo: row.correo || null, telefono: row.telefono || null,
    }).eq('id', id)
    setSavingId(null)
    if (error) { toast('No se pudo guardar'); return }
    toast('Cliente actualizado'); reload()
  }

  async function addCliente() {
    if (!nuevo.nombre.trim()) { toast('Escribe el nombre del cliente'); return }
    const { error } = await supabase.from('clientes').insert({
      empresa: nuevo.empresa.trim() || null, nombre: nuevo.nombre.trim(), rut: nuevo.rut.trim() || null, direccion: nuevo.direccion.trim() || null,
      correo: nuevo.correo.trim() || null, telefono: nuevo.telefono.trim() || null,
    })
    if (error) { toast('No se pudo agregar el cliente'); return }
    setNuevo({ empresa: '', nombre: '', rut: '', direccion: '', correo: '', telefono: '' })
    reload(); toast('Cliente agregado')
  }

  async function deleteCliente(c) {
    if (!(await confirm(`¿Eliminar a "${c.nombre}" de la lista de clientes?`))) return
    const { error } = await supabase.from('clientes').delete().eq('id', c.id)
    if (error) { toast('No se pudo eliminar'); return }
    toast('Cliente eliminado'); reload()
  }

  const visibles = busca.trim()
    ? rows.filter(c => c.nombre.toLowerCase().includes(busca.trim().toLowerCase()) || (c.empresa || '').toLowerCase().includes(busca.trim().toLowerCase()))
    : rows

  return (
    <>
      <div className="toolbar">
        <div><h1>Clientes</h1><div className="section-sub">Al cotizar o reservar, elige un cliente ya cargado aquí y sus datos se completan solos.</div></div>
      </div>
      <div className="card" style={{padding:0}}>
        <div className="card-head" style={{padding:'18px 18px 0'}}>
          <div className="f-group" style={{minWidth:220,marginBottom:0}}>
            <input type="text" value={busca} onChange={e => setBusca(e.target.value)} placeholder={`Buscar cliente… (${rows.length})`} />
          </div>
        </div>
        <div style={{overflowX:'auto'}}>
        <table className="data" style={{minWidth:900}}>
          <thead><tr><th>Empresa</th><th>Nombre cliente</th><th>RUT</th><th>Dirección</th><th>Correo</th><th>Contacto</th><th></th></tr></thead>
          <tbody>
            {!visibles.length && <tr><td colSpan={7} style={{textAlign:'center',color:'var(--mute2)',padding:24}}>{rows.length ? 'No hay clientes que coincidan.' : 'Aún no hay clientes cargados. Se agregan solos al guardar una cotización o una reserva, o puedes sumarlos aquí abajo.'}</td></tr>}
            {visibles.map(c => (
              <tr key={c.id}>
                <td><input type="text" value={c.empresa || ''} onChange={e => editField(c.id, 'empresa', e.target.value)} placeholder="Empresa" style={{width:130}} /></td>
                <td><input type="text" value={c.nombre} onChange={e => editField(c.id, 'nombre', e.target.value)} style={{width:130}} /></td>
                <td><input type="text" value={c.rut || ''} onChange={e => editField(c.id, 'rut', formatRut(e.target.value))} style={{width:100}} /></td>
                <td><input type="text" value={c.direccion || ''} onChange={e => editField(c.id, 'direccion', e.target.value)} style={{width:150}} /></td>
                <td><input type="text" value={c.correo || ''} onChange={e => editField(c.id, 'correo', e.target.value)} style={{width:150}} /></td>
                <td><input type="text" value={c.telefono || ''} onChange={e => editField(c.id, 'telefono', e.target.value)} placeholder="Nombre y/o teléfono" style={{width:130}} /></td>
                <td style={{display:'flex',gap:6,whiteSpace:'nowrap'}}>
                  <button className="btn-dark btn-sm" disabled={savingId===c.id} onClick={() => saveRow(c.id)}>{savingId===c.id ? 'Guardando…' : 'Guardar'}</button>
                  <button className="btn-danger btn-sm" onClick={() => deleteCliente(c)}>Eliminar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div style={{padding:16,borderTop:'1px solid var(--border)'}}>
          <div className="section-sub" style={{margin:'0 0 10px'}}>Agregar un cliente nuevo</div>
          <div className="quick-row" style={{gridTemplateColumns:'1.1fr 1.1fr 1fr 1.3fr 1.3fr 1.1fr auto'}}>
            <div className="f-group"><label>Empresa</label><input type="text" value={nuevo.empresa} onChange={e => setNuevo({...nuevo, empresa: e.target.value})} placeholder="Nombre de la empresa" /></div>
            <div className="f-group"><label>Nombre cliente</label><input type="text" value={nuevo.nombre} onChange={e => setNuevo({...nuevo, nombre: e.target.value})} placeholder="Persona de contacto" /></div>
            <div className="f-group"><label>RUT</label><input type="text" value={nuevo.rut} onChange={e => setNuevo({...nuevo, rut: formatRut(e.target.value)})} /></div>
            <div className="f-group"><label>Dirección</label><input type="text" value={nuevo.direccion} onChange={e => setNuevo({...nuevo, direccion: e.target.value})} /></div>
            <div className="f-group"><label>Correo</label><input type="text" value={nuevo.correo} onChange={e => setNuevo({...nuevo, correo: e.target.value})} /></div>
            <div className="f-group"><label>Contacto</label><input type="text" value={nuevo.telefono} onChange={e => setNuevo({...nuevo, telefono: e.target.value})} placeholder="Nombre y/o teléfono" /></div>
            <button className="btn-dark" onClick={addCliente}>Agregar</button>
          </div>
        </div>
      </div>
    </>
  )
}

// ============================================================
function Reservas({ camiones, reservas, conductores, tarifasComunas, perfil, toast, reload, openReserva, openReservaEdit, confirm }) {
  const today = isoDate(new Date())
  const sorted = [...reservas].sort((a, b) => b.fecha.localeCompare(a.fecha))

  async function quickDelete(r) {
    if (!(await confirm(`¿Eliminar la reserva de "${r.cliente}" (${new Date(r.fecha+'T00:00:00').toLocaleDateString('es-CL')})?`))) return
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
                  <td><strong>{r.empresa || r.cliente}</strong>{r.empresa && r.cliente ? <div className="section-sub" style={{margin:0}}>{r.cliente}</div> : null}</td>
                  <td>{cam?.nombre || '—'}</td>
                  <td className="mono">{new Date(r.fecha + 'T00:00:00').toLocaleDateString('es-CL')}</td>
                  <td className="mono">{r.hora ? r.hora.slice(0,5) : '—'}</td>
                  <td>{cond?.nombre || '—'}</td>
                  <td>{r.comuna}</td>
                  <td>{r.direccion}</td>
                  <td><span className={`tag ${r.estado === 'Pendiente' ? 'st-pendiente' : badgeClassFor(r.estado)}`}>{r.estado}</span></td>
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
function ReservaModal({ show, onClose, camiones, tarifasComunas, conductores, clientes, perfil, toast, reload, confirm, initialCamionId, initialFecha, editReserva, initialPrefill }) {
  const today = isoDate(new Date())
  const [form, setForm] = useState({ camionId: '', empresa: '', cliente: '', contacto: '', tipoTrabajo: '', fecha: today, hasta: '', hora: '', comuna: '', direccion: '', estado: 'Reservado', conductorId: '', descripcion: '' })
  const isEdit = !!editReserva

  useEffect(() => {
    if (!show) return
    if (editReserva) {
      setForm({
        camionId: editReserva.camion_id || camiones[0]?.id || '',
        empresa: editReserva.empresa || '',
        cliente: editReserva.cliente || '',
        contacto: editReserva.contacto || '',
        tipoTrabajo: editReserva.tipo_trabajo || '',
        fecha: editReserva.fecha || today,
        hasta: editReserva.fecha || today,
        hora: editReserva.hora ? editReserva.hora.slice(0,5) : '',
        comuna: editReserva.comuna || '',
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
        hasta: initialFecha || today,
        hora: '', tipoTrabajo: '', conductorId: '', descripcion: '', estado: 'Reservado',
        empresa: initialPrefill?.empresa || '',
        cliente: initialPrefill?.cliente || '',
        contacto: initialPrefill?.contacto || '',
        comuna: initialPrefill?.comuna || '',
        direccion: initialPrefill?.direccion || '',
      }))
    }
  }, [show, initialCamionId, initialFecha, editReserva, initialPrefill]) // eslint-disable-line

  useEffect(() => {
    if (!show) return
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [show]) // eslint-disable-line

  if (!show) return null

  const esMantencion = form.estado === 'Mantención'

  function onChangeCliente(valor) {
    // La comuna/dirección de la reserva es el lugar de trabajo, no la dirección de la empresa,
    // así que al autocompletar solo se rellenan empresa y contacto (nunca dirección).
    const match = (clientes || []).find(c => c.nombre.trim().toLowerCase() === valor.trim().toLowerCase())
    setForm(f => ({
      ...f,
      cliente: valor,
      empresa: match && !f.empresa ? (match.empresa || '') : f.empresa,
      contacto: match && !f.contacto ? (match.telefono || '') : f.contacto,
    }))
  }

  function onChangeEmpresa(valor) {
    const match = (clientes || []).find(c => (c.empresa || '').trim().toLowerCase() === valor.trim().toLowerCase() && valor.trim())
    setForm(f => ({
      ...f,
      empresa: valor,
      cliente: match && !f.cliente ? (match.nombre || '') : f.cliente,
      contacto: match && !f.contacto ? (match.telefono || '') : f.contacto,
    }))
  }

  // Guarda o enriquece el cliente en la base de clientes, para que la próxima vez que se
  // reserve para esta misma persona/empresa sus datos aparezcan solos. Es "best effort": si
  // falla, no interrumpe el guardado de la reserva (ya se guardó lo importante).
  async function guardarClienteSiCorresponde() {
    const empresaTrim = form.empresa.trim()
    const nombreTrim = form.cliente.trim()
    if (!empresaTrim && !nombreTrim) return
    try {
      const existente = (clientes || []).find(c =>
        (empresaTrim && (c.empresa || '').trim().toLowerCase() === empresaTrim.toLowerCase()) ||
        (nombreTrim && c.nombre.trim().toLowerCase() === nombreTrim.toLowerCase())
      )
      if (existente) {
        const cambios = {}
        if (!existente.empresa && empresaTrim) cambios.empresa = empresaTrim
        if (!existente.telefono && form.contacto) cambios.telefono = form.contacto
        if (Object.keys(cambios).length) await supabase.from('clientes').update(cambios).eq('id', existente.id)
      } else {
        const etiqueta = nombreTrim || empresaTrim
        if (await confirm(`"${etiqueta}" es un cliente nuevo. ¿Quieres guardarlo en la lista de clientes para completar sus datos automáticamente la próxima vez?`)) {
          await supabase.from('clientes').insert({
            empresa: empresaTrim || null, nombre: nombreTrim || empresaTrim, telefono: form.contacto || null,
          })
        }
      }
    } catch { /* no bloquea el flujo de la reserva */ }
  }

  async function save() {
    if (!form.camionId || !form.fecha) { toast('Completa el camión y la fecha'); return }
    const hastaFinal = form.hasta && form.hasta >= form.fecha ? form.hasta : form.fecha

    if (esMantencion) {
      if (isEdit) {
        const { error: delErr } = await supabase.from('reservas').delete().eq('id', editReserva.id)
        if (delErr) { toast('No se pudo actualizar la reserva'); return }
      }
      const { error } = await supabase.from('camiones').update({ estado_general: 'Mantención', hasta: hastaFinal }).eq('id', form.camionId)
      if (error) { toast('No se pudo poner el camión en mantención'); return }
      reload(); toast('Camión puesto en mantención'); onClose()
      return
    }

    if ((!form.empresa && !form.cliente) || !form.direccion) { toast('Completa la empresa o el nombre del cliente, y la dirección'); return }
    const dias = []
    for (let d = new Date(form.fecha + 'T00:00:00'), end = new Date(hastaFinal + 'T00:00:00'); d <= end; d.setDate(d.getDate() + 1)) {
      dias.push(isoDate(d))
    }
    const base = {
      camion_id: form.camionId, empresa: form.empresa || null, cliente: form.cliente, contacto: form.contacto || null,
      tipo_trabajo: form.tipoTrabajo || null, hora: form.hora || null,
      comuna: form.comuna, direccion: form.direccion, estado: form.estado,
      conductor_id: form.conductorId || null, descripcion: form.descripcion || null,
    }
    if (isEdit && dias.length === 1) {
      const { error } = await supabase.from('reservas').update({ ...base, fecha: dias[0] }).eq('id', editReserva.id)
      if (error) { toast('No se pudo guardar la reserva'); return }
    } else {
      if (isEdit) await supabase.from('reservas').delete().eq('id', editReserva.id)
      const { error } = await supabase.from('reservas').insert(dias.map(fecha => ({ ...base, fecha, valor: 0, creado_por: perfil.id })))
      if (error) { toast('No se pudo guardar la reserva'); return }
    }
    await guardarClienteSiCorresponde()
    reload(); toast(isEdit ? 'Reserva actualizada' : 'Reserva guardada'); onClose()
  }

  async function remove() {
    if (!isEdit) return
    if (!(await confirm(`¿Eliminar la reserva de "${editReserva.cliente}"?`))) return
    const { error } = await supabase.from('reservas').delete().eq('id', editReserva.id)
    if (error) { toast('No se pudo eliminar la reserva'); return }
    reload(); toast('Reserva eliminada'); onClose()
  }

  const camionSel = camiones.find(c => c.id === form.camionId)

  return (
    <div className="modal-bg show" onMouseDown={overlayMouseDown} onClick={e => overlayClick(e, onClose)}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Cerrar">×</button>
        <h3>{isEdit ? 'Editar reserva' : 'Nueva reserva'}</h3>
        <div className="msub">{camionSel ? `${camionSel.nombre} · ${new Date(form.fecha + 'T00:00:00').toLocaleDateString('es-CL')}` : 'Elige un camión disponible en la fecha indicada.'}</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div className="f-group"><label>Camión</label>
            <select value={form.camionId} onChange={e => setForm({...form, camionId: e.target.value})}>
              {camiones.map(c => <option key={c.id} value={c.id}>{c.nombre} ({c.tamano}m)</option>)}
            </select>
          </div>
          <div className="f-group"><label>Estado</label>
            <select value={form.estado} onChange={e => setForm({...form, estado: e.target.value})}>
              <option value="Reservado">Reservado</option><option value="Pendiente">Pendiente</option><option value="Mantención">Mantención</option>
            </select>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          <div className="f-group"><label>{esMantencion ? 'Desde' : 'Fecha'}</label><input type="date" value={form.fecha} onChange={e => setForm({...form, fecha: e.target.value})} /></div>
          <div className="f-group"><label>Hasta {esMantencion ? '' : '(opcional)'}</label><input type="date" value={form.hasta} min={form.fecha} onChange={e => setForm({...form, hasta: e.target.value})} /></div>
        </div>
        {esMantencion && <div className="section-sub" style={{margin:'-6px 0 12px'}}>El camión quedará en mantención en el calendario desde la fecha "Desde" hasta la fecha "Hasta".</div>}
        {!esMantencion && <>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div className="f-group"><label>Empresa</label>
              <input type="text" list="dl-empresas-reserva" value={form.empresa} onChange={e => onChangeEmpresa(e.target.value)} placeholder="Nombre de la empresa" autoComplete="off" />
              <datalist id="dl-empresas-reserva">
                {[...new Set((clientes || []).map(c => c.empresa).filter(Boolean))].map(e => <option key={e} value={e} />)}
              </datalist>
            </div>
            <div className="f-group"><label>Nombre cliente</label>
              <input type="text" list="dl-clientes-reserva" value={form.cliente} onChange={e => onChangeCliente(e.target.value)} placeholder="Persona de contacto" autoComplete="off" />
              <datalist id="dl-clientes-reserva">
                {(clientes || []).map(c => <option key={c.id} value={c.nombre} />)}
              </datalist>
            </div>
          </div>
          <div className="f-group"><label>Contacto</label><input type="text" value={form.contacto} onChange={e => setForm({...form, contacto: e.target.value})} placeholder="Nombre y/o teléfono de contacto" /></div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div className="f-group"><label>Tipo de trabajo</label>
              <input type="text" list="dl-tipo-trabajo" value={form.tipoTrabajo} onChange={e => setForm({...form, tipoTrabajo: e.target.value})} placeholder="Escribe o elige…" autoComplete="off" />
              <datalist id="dl-tipo-trabajo">
                {TIPOS_TRABAJO.map(t => <option key={t} value={t} />)}
              </datalist>
            </div>
            <div className="f-group"><label>Hora</label><input type="time" value={form.hora} onChange={e => setForm({...form, hora: e.target.value})} /></div>
          </div>
          <div className="f-group"><label>Comuna</label>
            <input type="text" list="dl-comunas-reserva" value={form.comuna} onChange={e => setForm({...form, comuna: e.target.value})} placeholder="Escribe para buscar…" autoComplete="off" />
            <datalist id="dl-comunas-reserva">
              {tarifasComunas.map(c => <option key={c.id} value={c.comuna} />)}
            </datalist>
          </div>
          <div className="f-group"><label>Dirección</label><input type="text" value={form.direccion} onChange={e => setForm({...form, direccion: e.target.value})} placeholder="Calle, número" /></div>
          <div className="f-group"><label>Conductor</label>
            <select value={form.conductorId} onChange={e => setForm({...form, conductorId: e.target.value})}>
              <option value="">Sin asignar</option>
              {conductores.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div className="f-group"><label>Descripción</label>
            <textarea value={form.descripcion} onChange={e => setForm({...form, descripcion: e.target.value})} placeholder="Detalles del trabajo, notas para el conductor, etc." rows={3} style={{width:'100%',padding:'9px 10px',border:'1px solid var(--border)',borderRadius:7,fontSize:'13.5px',fontFamily:'inherit',resize:'vertical'}} />
          </div>
        </>}
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
function Tarifas({ tarifaArriendo, tarifasComunas, isAdmin, toast, reload, confirm }) {
  const [arriendo, setArriendo] = useState(tarifaArriendo)
  const [comunas, setComunas] = useState(tarifasComunas)
  const [filtro, setFiltro] = useState('')
  const [nueva, setNueva] = useState({ comuna: '', p13: '', p18: '', p20: '' })
  useEffect(() => setArriendo(tarifaArriendo), [tarifaArriendo])
  useEffect(() => setComunas(tarifasComunas), [tarifasComunas])

  async function saveAll() {
    const upsertsArriendo = Object.entries(arriendo).map(([tamano, valor]) => ({ tamano: Number(tamano), valor: Number(valor) }))
    const upsertsComunas = comunas.map(c => ({ id: c.id, comuna: c.comuna, p13: Number(c.p13), p18: Number(c.p18), p20: Number(c.p20) }))
    const [r1, r2] = await Promise.all([
      supabase.from('tarifas_arriendo').upsert(upsertsArriendo),
      supabase.from('tarifas_comunas').upsert(upsertsComunas),
    ])
    if (r1.error || r2.error) {
      console.error('tarifas_arriendo.upsert', r1.error); console.error('tarifas_comunas.upsert', r2.error)
      toast('No se pudieron guardar: ' + ((r1.error || r2.error).message || 'revisa la consola'))
      return
    }
    toast('Tarifas guardadas'); reload()
  }

  async function addComuna() {
    if (!nueva.comuna.trim()) { toast('Escribe el nombre de la comuna'); return }
    const { error } = await supabase.from('tarifas_comunas').insert({
      comuna: nueva.comuna.trim(), p13: Number(nueva.p13)||0, p18: Number(nueva.p18)||0, p20: Number(nueva.p20)||0,
    })
    if (error) { console.error('tarifas_comunas.insert', error); toast('No se pudo agregar: ' + (error.message || '¿ya existe esa comuna?')); return }
    setNueva({ comuna: '', p13: '', p18: '', p20: '' })
    reload(); toast('Comuna agregada')
  }

  async function deleteComuna(c) {
    if (!(await confirm(`¿Eliminar "${c.comuna}" de la lista de tarifas?`))) return
    const { error } = await supabase.from('tarifas_comunas').delete().eq('id', c.id)
    if (error) { toast('No se pudo eliminar'); return }
    setFiltro('')
    reload(); toast('Comuna eliminada')
  }

  const visibles = filtro.trim()
    ? comunas.filter(c => c.comuna.toLowerCase().includes(filtro.trim().toLowerCase()))
    : comunas

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
            {[13, 18, 20].map(sz => (
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
        {isAdmin && <div style={{marginTop:12}}><button className="btn-dark btn-sm" onClick={saveAll}>Guardar cambios</button></div>}
      </div>
      <div className="card" style={{padding:0}}>
        <div className="card-head" style={{padding:'18px 18px 0'}}>
          <h2>Traslado por comuna</h2>
          <div className="f-group" style={{minWidth:220,marginBottom:0}}>
            <div style={{display:'flex',gap:6}}>
              <input type="text" value={filtro} onChange={e => setFiltro(e.target.value)} placeholder={`Buscar comuna… (${comunas.length})`} />
              {filtro && <button className="btn-outline btn-sm" onClick={() => setFiltro('')}>×</button>}
            </div>
          </div>
        </div>
        <table className="data">
          <thead><tr><th>Comuna</th><th>13 metros</th><th>18 metros</th><th>20 metros</th>{isAdmin && <th></th>}</tr></thead>
          <tbody>
            {!visibles.length && <tr><td colSpan={5} style={{textAlign:'center',color:'var(--mute2)',padding:20}}>No hay comunas que coincidan.</td></tr>}
            {visibles.map((c) => {
              const i = comunas.findIndex(x => x.id === c.id)
              return (
                <tr key={c.id}>
                  <td><strong>{c.comuna}</strong></td>
                  {['p13', 'p18', 'p20'].map(k => (
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
              <div className="f-group"><label>18 m</label><input type="text" inputMode="numeric" value={nueva.p18 === '' ? '' : fmtInputMoney(nueva.p18)} onChange={e => setNueva({...nueva, p18: parseMoneyInput(e.target.value)})} placeholder="0" /></div>
              <div className="f-group"><label>20 m</label><input type="text" inputMode="numeric" value={nueva.p20 === '' ? '' : fmtInputMoney(nueva.p20)} onChange={e => setNueva({...nueva, p20: parseMoneyInput(e.target.value)})} placeholder="0" /></div>
              <button className="btn-dark" onClick={addComuna}>Agregar</button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ============================================================
// Datos fijos del cotizador (misma información en cada cotización)
const DATOS_EMPRESA = {
  razon: 'Saavedra y Compañía Ltda.',
  rubro: 'Ingeniería Eléctrica y Obras Civiles',
  rut: '76.120.630-3',
  direccion: 'Argentina 821, La Cisterna',
  telefono: '+56 961234404',
  web: 'www.ilumsa.cl',
  correo: 'nsaavedra@ilumsa.cl',
}
const DATOS_BANCARIOS = [
  'Saavedra y compañía limitada',
  '76.120.630-3',
  'Banco BCI',
  'Cuenta Corriente 293 77 293',
  'contacto@ilumsa.cl',
]
// El bloque de condiciones comerciales ahora es texto enriquecido (HTML), editable con el
// mini-editor tipo Word (negrita + color de letra) que está más abajo. Los bloques que están
// completos en negrita se muestran como título en negrita/azul en el PDF; el resto se muestra
// como viñeta, respetando la negrita/color que se le haya puesto a cada palabra.
const CONDICIONES_DEFAULT = [
  '<div style="color:#002060"><b>Condiciones Comerciales:</b></div>',
  '<div style="color:#002060">- <b>Reserva de Servicio:</b> Para garantizar la disponibilidad del equipo, se requiere la emisión de una Orden de Compra (OC) y/o el abono del 50% de la cotización. El saldo restante deberá ser regularizado al finalizar la prestación del servicio.</div>',
  '<div style="color:#002060">- <b>Continuidad por Condiciones Climáticas:</b> En caso de que factores climáticos impidan el desarrollo normal de las faenas, el cobro se limitará exclusivamente al tiempo de permanencia del equipo y personal en terreno, sin considerar necesariamente las horas de operación efectiva.</div>',
  '<div style="color:#002060">- <b>Extensiones de Horario:</b> Las labores que excedan el horario habitual (después de las 17:00 horas los días lunes y martes, y desde las 16:00 horas los días miércoles a viernes) tendrán un recargo del 30% del valor hora en jornada hábil. Para extensiones en horario inhábil, la hora se valorizará de forma proporcional.</div>',
  '<div style="color:#002060">- <b>Servicio de Arriendo de Arnés de Seguridad:</b> En caso de no contar con uno, el cliente podrá solicitar el arriendo de un arnés de seguridad certificado para el trabajo en altura. Su entrega estará sujeta a la firma de un check list de recepción y un deslinde de responsabilidad por mal uso. Es responsabilidad exclusiva del cliente garantizar que todo su personal en terreno cuente con los demás Equipos de Protección Personal (EPP) obligatorios, tales como casco de seguridad con barbiquejo, guantes y calzado de seguridad.</div>',
  '<div style="color:#002060"><b>Equipamiento y Certificación:</b></div>',
  '<div style="color:#002060">- <b>Personal Calificado:</b> El servicio es operado exclusivamente por un conductor con licencia profesional y certificación técnica en operación de camiones alza hombre vigente.</div>',
  '<div style="color:#002060">- <b>Seguridad y Normativa:</b> El hidroelevador cuenta con su certificación técnica al día y está equipado íntegramente con elementos de seguridad (conos, botiquín y extintores) bajo la normativa vigente.</div>',
  '<div style="color:#002060">- <b>Respaldo:</b> La unidad dispone de seguro vehicular externo para cobertura de eventualidades durante el servicio.</div>',
  '<div style="color:#002060"><b>Marco de Responsabilidad y Operación:</b></div>',
  '<div style="color:#002060">- <b>Cuidado del Activo:</b> Se solicita al arrendatario velar por la integridad del equipo durante su permanencia en la obra, asumiendo la responsabilidad por daños derivados de la manipulación o entorno de trabajo.</div>',
  '<div style="color:#002060">- <b>Facultad de Detención por Seguridad:</b> El conductor/operador está plenamente facultado para suspender las maniobras si evalúa que no se cumplen las condiciones mínimas de seguridad (tales como exceso de viento, falta de EPP o interferencias en el entorno). En este caso, se deberá cancelar el valor del traslado y el tiempo de permanencia del equipo en terreno.</div>',
  '<div style="color:#002060">- <b>Gestión Administrativa:</b> Es responsabilidad del cliente asegurar que el lugar de trabajo cuente con los permisos municipales o autorizaciones de tránsito necesarios para la operación, a fin de evitar interrupciones o sanciones administrativas.</div>',
  '<div style="color:#002060"><b>Cancelaciones:</b></div>',
  '<div style="color:#002060">- <b>Aviso de Cancelación:</b> Ante una anulación del servicio sin anticipación, se procederá al cobro del valor asociado al traslado del equipo.</div>',
].join('')

// Colores exactos del formato Excel original (navy y azul medio)
const NAVY = [0, 10, 116]
const BLUE2 = [31, 72, 124]
const GRAY_FILL = [237, 237, 237]

// Texto por defecto del primer ítem — queda precargado pero se puede editar libremente
const ITEM_DEFAULT_DESC = 'Arriendo de camión alza hombre de 20 metros de altura con canastillo doble (capacidad para dos personas) desde las 21:00 hrs. Incluye conductor/operador, combustible y tag.'

function nuevoItem() { return { descripcion: ITEM_DEFAULT_DESC, altura: '', unidad: 'Hora', cantidad: 1, valorUnit: 0 } }

// Formatea un RUT chileno mientras se escribe: 779768414 -> 77.976.841-4 (sin que el usuario tenga que poner puntos ni guion)
function formatRut(value) {
  const clean = String(value).replace(/[^0-9kK]/g, '').toUpperCase()
  if (!clean) return ''
  const dv = clean.slice(-1)
  let num = clean.slice(0, -1)
  if (!num) return dv
  num = num.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${num}-${dv}`
}

// Nombre de archivo por defecto, igual al formato que ya usan: PPTO<numero>_<CLIENTE EN MAYÚSCULAS>
function nombreArchivoDefault(numero, cliente) {
  const cli = String(cliente || '').trim().toUpperCase().replace(/[^A-ZÁÉÍÓÚÑ0-9 ]+/g, '').replace(/ +/g, ' ')
  return `PPTO${String(numero || '').padStart(4, '0')}${cli ? '_' + cli : ''}`
}

// Carga el logo y su tamaño real, para dibujarlo sin deformarlo (mantiene su proporción original)
async function getLogoInfo() {
  try {
    const res = await fetch('/logo-pdf.png')
    const blob = await res.blob()
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    const { w, h } = await new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 })
      img.onerror = () => resolve({ w: 1, h: 1 })
      img.src = dataUrl
    })
    return { dataUrl, w, h }
  } catch (e) { return null }
}

// Fuentes gratuitas (licencia OFL, de uso libre) parecidas a las originales del Excel —
// no se pueden incrustar Bodoni MT Black / Bookman Old Style / Cambria porque son fuentes
// comerciales de Microsoft. Se cargan en vivo desde el repo oficial de Google Fonts.
const FONT_FILES = {
  display: ['https://raw.githubusercontent.com/google/fonts/main/ofl/abrilfatface/AbrilFatface-Regular.ttf', 'AbrilFatface-Regular.ttf', 'display', 'normal'],
  serifRegular: ['https://raw.githubusercontent.com/google/fonts/main/ofl/ptserif/PT_Serif-Web-Regular.ttf', 'PTSerif-Regular.ttf', 'serif', 'normal'],
  serifBold: ['https://raw.githubusercontent.com/google/fonts/main/ofl/ptserif/PT_Serif-Web-Bold.ttf', 'PTSerif-Bold.ttf', 'serif', 'bold'],
  slabRegular: ['https://raw.githubusercontent.com/google/fonts/main/ofl/zillaslab/ZillaSlab-Regular.ttf', 'ZillaSlab-Regular.ttf', 'slab', 'normal'],
  slabBold: ['https://raw.githubusercontent.com/google/fonts/main/ofl/zillaslab/ZillaSlab-Bold.ttf', 'ZillaSlab-Bold.ttf', 'slab', 'bold'],
}

// Codifica a base64 a mano (byte a byte, sin fromCharCode.apply ni Blob) — evita problemas
// de compatibilidad con archivos binarios grandes en algunos navegadores/extensiones.
function uint8ToBase64(bytes) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let result = ''
  const len = bytes.length
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2]
    const triplet = (b0 << 16) | ((b1 || 0) << 8) | (b2 || 0)
    result += chars[(triplet >> 18) & 0x3F]
    result += chars[(triplet >> 12) & 0x3F]
    result += i + 1 < len ? chars[(triplet >> 6) & 0x3F] : '='
    result += i + 2 < len ? chars[triplet & 0x3F] : '='
  }
  return result
}

async function fetchFontBase64(url) {
  const res = await fetch(url)
  const buf = await res.arrayBuffer()
  return uint8ToBase64(new Uint8Array(buf))
}

// Se guardan en memoria una vez descargadas, para no volver a pedirlas por internet en
// cada cotización dentro de la misma sesión del navegador.
let fontBase64Cache = null

// Registra las 5 fuentes en el PDF. Si por algún motivo no hay internet o falla la carga,
// se sigue usando "times" (la fuente de respaldo de jsPDF) para no romper la descarga.
async function registerFonts(doc) {
  try {
    const entries = Object.values(FONT_FILES)
    if (!fontBase64Cache) fontBase64Cache = await Promise.all(entries.map(([url]) => fetchFontBase64(url)))
    entries.forEach(([, filename, family, style], i) => {
      doc.addFileToVFS(filename, fontBase64Cache[i])
      doc.addFont(filename, family, style)
    })
    return { title: 'display', serif: 'serif', slab: 'slab' }
  } catch (e) {
    fontBase64Cache = null
    return { title: 'times', serif: 'times', slab: 'times' }
  }
}

// --- Soporte de texto enriquecido (negrita + color) para "Condiciones comerciales" ---

// true si el texto trae etiquetas HTML (viene del editor tipo Word). Si es una cotización
// guardada antes de este cambio (texto plano con saltos de línea), se sigue mostrando con
// el formato anterior más abajo, para no alterar cotizaciones ya emitidas.
function isHtmlContent(s) { return /<[a-z][\s\S]*>/i.test(String(s || '')) }

// Convierte un color de CSS ("#rrggbb" o "rgb(r,g,b)", que es lo que entrega el navegador
// al usar el selector de color del mini-editor) a un arreglo [r,g,b] para jsPDF.
function colorToRgb(c) {
  if (!c) return null
  const s = String(c).trim()
  if (s.startsWith('#')) {
    let hex = s.slice(1)
    if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('')
    const num = parseInt(hex, 16)
    if (Number.isNaN(num)) return null
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255]
  }
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  return null
}

// Recorre el HTML guardado y lo convierte en "bloques" (párrafos), cada uno con una lista de
// fragmentos {text, bold, color} — así se puede dibujar en el PDF respetando exactamente la
// negrita/color que se le puso a cada palabra desde el mini-editor.
function parseHtmlToBlocks(html) {
  const container = document.createElement('div')
  container.innerHTML = html
  const blocks = []
  let current = []
  function flush() { if (current.length) { blocks.push(current); current = [] } }
  function walk(node, bold, color) {
    if (node.nodeType === 3) {
      if (node.textContent) current.push({ text: node.textContent, bold, color })
      return
    }
    if (node.nodeType !== 1) return
    const tag = node.tagName
    if (tag === 'BR') { flush(); return }
    const isBlock = tag === 'DIV' || tag === 'P'
    if (isBlock) flush()
    let nb = bold
    let nc = color
    if (tag === 'B' || tag === 'STRONG') nb = true
    if (node.style && node.style.fontWeight && (node.style.fontWeight === 'bold' || Number(node.style.fontWeight) >= 600)) nb = true
    if (node.style && node.style.color) nc = colorToRgb(node.style.color) || nc
    if (tag === 'FONT' && node.getAttribute('color')) nc = colorToRgb(node.getAttribute('color')) || nc
    Array.from(node.childNodes).forEach(child => walk(child, nb, nc))
    if (isBlock) flush()
  }
  Array.from(container.childNodes).forEach(n => walk(n, false, null))
  flush()
  return blocks
}

// Dibuja los bloques de "condiciones comerciales" en el PDF, con ajuste de línea (word-wrap)
// palabra por palabra, respetando la negrita/color de cada una. Los bloques que están
// completos en negrita (los títulos de sección) se pintan en azul navy con espacio extra
// arriba, igual que el formato original. `opts.scale` reduce tamaño de letra/espaciado de forma
// proporcional (para que todo quepa en una sola página) y `opts.draw:false` solo calcula el
// alto que ocuparía, sin dibujar nada — así se puede medir antes de decidir la escala final.
function renderConditionBlocks(doc, blocks, marginL, contentW, startY, F, NAVY, opts = {}) {
  const { scale = 1, draw = true } = opts
  let cy = startY
  const lineH = 10.2 * scale
  blocks.forEach(block => {
    const words = []
    block.forEach(run => {
      String(run.text).split(/(\s+)/).forEach(part => {
        if (!part || /^\s+$/.test(part)) return
        words.push({ text: part, bold: run.bold, color: run.color })
      })
    })
    if (!words.length) { cy += 2.5 * scale; return }
    const allBold = words.every(w => w.bold)
    if (allBold) cy += 6 * scale
    const fontSize = (allBold ? 8.8 : 8.2) * scale
    doc.setFontSize(fontSize)
    const spaceW = doc.getTextWidth(' ')
    let line = []
    let lineWidth = 0
    function flushLine() {
      if (!line.length) return
      if (draw) {
        let x = marginL
        line.forEach(w => {
          doc.setFont(F.slab, w.bold ? 'bold' : 'normal')
          doc.setFontSize(fontSize)
          doc.setTextColor(...(w.color || (allBold ? NAVY : [0, 0, 0])))
          doc.text(w.text, x, cy)
          x += doc.getTextWidth(w.text) + spaceW
        })
      }
      cy += lineH
      line = []; lineWidth = 0
    }
    words.forEach(w => {
      doc.setFont(F.slab, w.bold ? 'bold' : 'normal')
      doc.setFontSize(fontSize)
      const wWidth = doc.getTextWidth(w.text)
      const extra = line.length ? spaceW : 0
      if (line.length && lineWidth + extra + wWidth > contentW) flushLine()
      line.push(w)
      lineWidth += (line.length > 1 ? spaceW : 0) + wWidth
    })
    flushLine()
    if (!allBold) cy += 1.5 * scale
  })
  return cy
}

async function generarPdfCotizacion(q, nombreArchivo) {
  const logo = await getLogoInfo()
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const F = await registerFonts(doc)
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const marginL = 36, marginR = 36, marginB = 30
  const contentW = pageW - marginL - marginR
  let y = 42

  // Logo a su proporción real (no se aplasta), con una altura fija cómoda
  let logoW = 0
  if (logo) {
    const maxH = 46, maxW = 95
    const ratio = logo.w / logo.h
    let lh = maxH, lw = maxH * ratio
    if (lw > maxW) { lw = maxW; lh = maxW / ratio }
    logoW = lw
    try { doc.addImage(logo.dataUrl, 'PNG', marginL, y, lw, lh) } catch (e) { /* logo opcional */ }
  }
  // Centrado sobre todo el ancho de la hoja (igual que en la plantilla original), no solo
  // en el espacio a la derecha del logo — así el título queda alineado con la tabla de abajo.
  const headCenterX = (marginL + pageW - marginR) / 2
  doc.setFont(F.title, 'normal'); doc.setFontSize(19); doc.setTextColor(...NAVY)
  doc.text(DATOS_EMPRESA.razon, headCenterX, y + 13, { align: 'center' })
  doc.setFont(F.slab, 'normal'); doc.setFontSize(9.5); doc.setTextColor(30, 30, 30)
  doc.text(DATOS_EMPRESA.rubro, headCenterX, y + 30, { align: 'center' })
  doc.setFontSize(8.5); doc.setTextColor(...BLUE2)
  doc.text(`Rut: ${DATOS_EMPRESA.rut} / ${DATOS_EMPRESA.direccion}`, headCenterX, y + 44, { align: 'center' })
  doc.text(`Teléfono: ${DATOS_EMPRESA.telefono}    Web: ${DATOS_EMPRESA.web}    Correo: ${DATOS_EMPRESA.correo}`, headCenterX, y + 57, { align: 'center' })

  y += 70
  doc.setDrawColor(0); doc.setLineWidth(0.75); doc.line(marginL, y, pageW - marginR, y)
  y += 16

  doc.setFont(F.slab, 'bold'); doc.setFontSize(9.5); doc.setTextColor(...NAVY)
  doc.text('Cliente:', marginL, y)
  doc.setFont(F.serif, 'bold')
  doc.text(q.cliente || '—', marginL + 48, y)
  doc.setTextColor(0, 0, 0)
  doc.text(`N°.    ${q.numero}`, pageW - marginR - 140, y)
  y += 13
  doc.setFont(F.serif, 'normal'); doc.setTextColor(0, 0, 0); doc.setFontSize(9)
  if (q.cliente_rut) doc.text(q.cliente_rut, marginL + 48, y)
  doc.setFont(F.serif, 'bold')
  doc.text(new Date(q.fecha + 'T00:00:00').toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase(), pageW - marginR - 140, y)
  doc.setFont(F.serif, 'normal')
  y += 13
  if (q.cliente_direccion) { doc.text(q.cliente_direccion, marginL + 48, y); y += 13 }
  if (q.cliente_correo) { doc.text(q.cliente_correo, marginL + 48, y); y += 13 }

  y += 6
  autoTable(doc, {
    startY: y,
    head: [['ÍTEM', 'DESCRIPCIÓN', 'UNIDAD', 'CANTIDAD', 'VALOR UN', 'VALOR TOTAL']],
    body: q.items.map((it, i) => [
      String(i + 1), it.descripcion, it.unidad, String(it.cantidad),
      fmtMoney(it.valorUnit), fmtMoney((Number(it.cantidad) || 0) * (Number(it.valorUnit) || 0)),
    ]),
    theme: 'plain',
    styles: { font: F.serif, fontStyle: 'normal', fontSize: 9.5, cellPadding: { top: 4, bottom: 4, left: 3, right: 3 }, lineColor: [90, 90, 90], lineWidth: { bottom: 0.5 } },
    headStyles: { font: F.slab, fontStyle: 'bold', fontSize: 9, textColor: NAVY, lineColor: [0, 0, 0], lineWidth: { bottom: 0.75 } },
    columnStyles: {
      0: { cellWidth: 34, halign: 'center', font: F.serif, fontStyle: 'bold', textColor: NAVY },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 50, halign: 'center' },
      3: { cellWidth: 60, halign: 'center' },
      4: { cellWidth: 68, halign: 'center' },
      5: { cellWidth: 74, halign: 'center' },
    },
    margin: { left: marginL, right: marginR },
  })

  const totalRows = [['SUBTOTAL NETO', fmtMoney(q.subtotal)]]
  if (q.descuento_pct > 0) totalRows.push([`DESCUENTO (${q.descuento_pct}%)`, '-' + fmtMoney(q.subtotal - q.neto)])
  const totalNetoIdx = totalRows.length
  totalRows.push(['TOTAL NETO', fmtMoney(q.neto)], ['IVA (19%)', fmtMoney(q.iva)], ['TOTAL', fmtMoney(q.total)])

  // Datos bancarios (izquierda) y el resumen de totales (derecha) van uno al lado del otro,
  // igual que en la cotización de referencia — así se ahorra bastante espacio vertical, que
  // es clave para que las condiciones comerciales alcancen a entrar en la misma página.
  const afterItemsY = doc.lastAutoTable.finalY + 14
  const totalsW = 200
  autoTable(doc, {
    startY: afterItemsY,
    body: totalRows,
    theme: 'plain',
    styles: { fontStyle: 'bold', fontSize: 8.5, cellPadding: 4, lineColor: [0, 0, 0], lineWidth: { bottom: 0.5 } },
    columnStyles: { 0: { font: F.slab, textColor: NAVY, cellWidth: totalsW * 0.55 }, 1: { font: F.serif, textColor: 0, halign: 'right', cellWidth: totalsW * 0.45 } },
    margin: { left: pageW - marginR - totalsW },
    didParseCell: (data) => { if (data.row.index === totalNetoIdx) data.cell.styles.fillColor = GRAY_FILL },
  })
  const totalsFinalY = doc.lastAutoTable.finalY

  doc.setFont(F.slab, 'bold'); doc.setFontSize(9); doc.setTextColor(...NAVY)
  const banco = ['Datos Bancarios:', ...DATOS_BANCARIOS]
  banco.forEach((line, i) => doc.text(line, marginL, afterItemsY + 10 + i * 11.5))
  const bancoFinalY = afterItemsY + 10 + banco.length * 11.5

  let cy = Math.max(totalsFinalY, bancoFinalY) + 16
  if (isHtmlContent(q.condiciones)) {
    // Texto enriquecido guardado desde el mini-editor (negrita/color). Para que todo quede
    // dentro de una sola página (como en el formato original) primero se mide cuánto ocuparía
    // el texto y, si no entra completo, se reduce un poco el tamaño de letra — pero solo hasta
    // un mínimo cómodo de leer (nunca queda "microscópico"). Si el texto es tan largo que ni así
    // alcanza, se continúa en una segunda página completa (con tamaño normal) en vez de achicar
    // la letra hasta hacerla ilegible.
    const blocks = parseHtmlToBlocks(q.condiciones)
    const scales = [1, 0.95, 0.9, 0.85, 0.8]
    function bestScale(availableH) {
      for (const s of scales) {
        const h = renderConditionBlocks(doc, blocks, marginL, contentW, 0, F, NAVY, { scale: s, draw: false })
        if (h <= availableH) return s
      }
      return null
    }
    let scale = bestScale(pageH - marginB - cy)
    if (scale == null) {
      doc.addPage()
      cy = 42
      scale = bestScale(pageH - marginB - cy) || 0.8
    }
    cy = renderConditionBlocks(doc, blocks, marginL, contentW, cy, F, NAVY, { scale, draw: true })
  } else {
    // Cotizaciones guardadas antes de este cambio (texto plano): se mantiene el formato anterior,
    // donde las líneas que terminan en ":" se pintan como título en negrita.
    String(q.condiciones || '').split('\n').forEach(raw => {
      const l = raw.trim()
      if (!l) return
      if (l.endsWith(':')) {
        cy += 6
        doc.setFont(F.slab, 'bold'); doc.setFontSize(9); doc.setTextColor(...NAVY)
        doc.text(l, marginL, cy); cy += 13
      } else {
        doc.setFont(F.slab, 'normal'); doc.setFontSize(8.5); doc.setTextColor(0, 0, 0)
        const wrapped = doc.splitTextToSize('- ' + l, contentW)
        doc.text(wrapped, marginL, cy); cy += wrapped.length * 11 + 4
      }
    })
  }

  const nombre = (nombreArchivo && nombreArchivo.trim()) || nombreArchivoDefault(q.numero, q.cliente)
  doc.save(`${nombre.replace(/\.pdf$/i, '')}.pdf`)
}

function Cotizaciones({ cotizaciones, tarifasComunas, tarifaArriendo, clientes, perfil, toast, reload, confirm, openReservaDraft }) {
  const today = isoDate(new Date())
  const nextNumero = cotizaciones.reduce((max, c) => Math.max(max, c.numero || 0), 0) + 1

  // El número se autocompleta con el siguiente correlativo, pero se puede editar a mano.
  // Si no se toca, se sigue actualizando solo a medida que se guardan nuevas cotizaciones.
  const [numero, setNumero] = useState(nextNumero)
  const [numeroEditado, setNumeroEditado] = useState(false)
  useEffect(() => { if (!numeroEditado) setNumero(nextNumero) }, [nextNumero, numeroEditado])
  function onChangeNumero(v) { setNumero(v.replace(/[^\d]/g, '')); setNumeroEditado(true) }

  const [cliente, setCliente] = useState('')
  const [clienteNombre, setClienteNombre] = useState('')
  const [clienteContacto, setClienteContacto] = useState('')
  const [clienteRut, setClienteRut] = useState('')
  const [clienteDireccion, setClienteDireccion] = useState('')
  const [clienteCorreo, setClienteCorreo] = useState('')
  // Si el nombre escrito coincide con un cliente ya cargado (elegido de la lista de sugerencias),
  // se completan RUT/dirección/correo solos — pero quedan editables igual que siempre. "Cliente"
  // es lo que se imprime en la cotización (empresa); "Nombre cliente" y "Contacto" son solo para
  // guardar los datos de la persona de contacto en la sección Clientes, no salen en el PDF.
  function onChangeCliente(valor) {
    setCliente(valor)
    const match = clientes.find(c => (c.empresa || '').trim().toLowerCase() === valor.trim().toLowerCase() || c.nombre.trim().toLowerCase() === valor.trim().toLowerCase())
    if (match) {
      if (match.rut) setClienteRut(match.rut)
      if (match.direccion) setClienteDireccion(match.direccion)
      if (match.correo) setClienteCorreo(match.correo)
      if (!clienteNombre && match.nombre) setClienteNombre(match.nombre)
      if (!clienteContacto && match.telefono) setClienteContacto(match.telefono)
    }
  }
  function onChangeClienteNombre(valor) {
    setClienteNombre(valor)
    const match = clientes.find(c => c.nombre.trim().toLowerCase() === valor.trim().toLowerCase())
    if (match) {
      if (!cliente && match.empresa) setCliente(match.empresa)
      if (!clienteRut && match.rut) setClienteRut(match.rut)
      if (!clienteDireccion && match.direccion) setClienteDireccion(match.direccion)
      if (!clienteCorreo && match.correo) setClienteCorreo(match.correo)
      if (!clienteContacto && match.telefono) setClienteContacto(match.telefono)
    }
  }
  const [fecha, setFecha] = useState(today)
  const [items, setItems] = useState([nuevoItem()])
  const [aplicaDescuento, setAplicaDescuento] = useState(false)
  const [descuentoPct, setDescuentoPct] = useState('')
  const [condiciones, setCondiciones] = useState(CONDICIONES_DEFAULT)
  const condicionesRef = useRef(null)
  const savedRangeRef = useRef(null)
  function saveSelection() {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && condicionesRef.current && condicionesRef.current.contains(sel.anchorNode)) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange()
    }
  }
  function restoreSelection() {
    const sel = window.getSelection()
    if (sel && savedRangeRef.current) { sel.removeAllRanges(); sel.addRange(savedRangeRef.current) }
  }
  function execRte(cmd, value) {
    restoreSelection()
    if (condicionesRef.current) condicionesRef.current.focus()
    document.execCommand(cmd, false, value)
    if (condicionesRef.current) setCondiciones(condicionesRef.current.innerHTML)
  }
  function setCondicionesColor(color) {
    restoreSelection()
    if (condicionesRef.current) condicionesRef.current.focus()
    document.execCommand('foreColor', false, color)
    if (condicionesRef.current) setCondiciones(condicionesRef.current.innerHTML)
  }
  useEffect(() => {
    if (condicionesRef.current && condicionesRef.current.innerHTML !== condiciones) {
      condicionesRef.current.innerHTML = condiciones
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [guardando, setGuardando] = useState(false)

  // Selección múltiple para borrar varias cotizaciones guardadas de una vez.
  const [selectMode, setSelectMode] = useState(false)
  const [seleccionadas, setSeleccionadas] = useState([])
  function toggleSelectMode() { setSelectMode(v => !v); setSeleccionadas([]) }
  function toggleSeleccionada(id) {
    setSeleccionadas(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  // Nombre del archivo: se autocompleta con PPTO<número>_<CLIENTE>, pero se puede editar a mano
  const [nombreArchivo, setNombreArchivo] = useState(nombreArchivoDefault(nextNumero, ''))
  const [archivoEditado, setArchivoEditado] = useState(false)
  useEffect(() => { if (!archivoEditado) setNombreArchivo(nombreArchivoDefault(numero, cliente)) }, [numero, cliente, archivoEditado])
  function onChangeNombreArchivo(v) { setNombreArchivo(v); setArchivoEditado(true) }

  // Traslado: siempre está presente en el formulario (no hay que agregarlo a mano). Se calcula
  // solo desde la tabla de Tarifas según tamaño de camión y comuna, y se puede editar o desmarcar.
  const [incluirTraslado, setIncluirTraslado] = useState(true)
  const [trasladoTamano, setTrasladoTamano] = useState('13')
  const [trasladoComuna, setTrasladoComuna] = useState('')
  const [trasladoCantidad, setTrasladoCantidad] = useState(1)
  const [trasladoValor, setTrasladoValor] = useState(0)
  const [trasladoValorEditado, setTrasladoValorEditado] = useState(false)
  const trasladoValorAuto = (tarifasComunas.find(c => c.comuna === trasladoComuna) || {})['p' + trasladoTamano] || 0
  useEffect(() => { if (!trasladoValorEditado) setTrasladoValor(trasladoValorAuto) }, [trasladoValorAuto, trasladoValorEditado])
  function onChangeTrasladoValor(v) { setTrasladoValor(parseMoneyInput(v)); setTrasladoValorEditado(true) }

  function updateItem(i, field, value) {
    setItems(rows => rows.map((r, idx) => idx === i ? { ...r, [field]: value } : r))
  }
  // Al elegir la altura del camión, sugiere el valor unitario según la tarifa de arriendo por hora,
  // pero el campo queda editable igual que siempre: el usuario puede modificarlo después.
  function onChangeAltura(i, altura) {
    setItems(rows => rows.map((r, idx) => {
      if (idx !== i) return r
      const sugerido = altura && tarifaArriendo[altura] != null ? Number(tarifaArriendo[altura]) || 0 : r.valorUnit
      return { ...r, altura, valorUnit: sugerido }
    }))
  }
  function addItem() { setItems(rows => [...rows, nuevoItem()]) }
  function removeItem(i) { setItems(rows => rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows) }

  // Descripción del traslado: se autocompleta según la comuna elegida, pero también se puede escribir a mano en la tabla de ítems
  const [trasladoDescripcion, setTrasladoDescripcion] = useState('')
  const [trasladoDescEditada, setTrasladoDescEditada] = useState(false)
  useEffect(() => { if (!trasladoDescEditada) setTrasladoDescripcion(`Traslado a ${trasladoComuna || '—'} (ida y vuelta)`) }, [trasladoComuna, trasladoDescEditada])
  function onChangeTrasladoDescripcion(v) { setTrasladoDescripcion(v); setTrasladoDescEditada(true) }

  const itemTraslado = { descripcion: trasladoDescripcion, unidad: 'un', cantidad: trasladoCantidad, valorUnit: trasladoValor }
  const itemsFinal = incluirTraslado ? [...items, itemTraslado] : items

  const subtotal = itemsFinal.reduce((s, it) => s + (Number(it.cantidad) || 0) * (Number(it.valorUnit) || 0), 0)
  const descuento = aplicaDescuento ? subtotal * (Number(descuentoPct) || 0) / 100 : 0
  const neto = subtotal - descuento
  const iva = neto * 0.19
  const total = neto + iva

  function resetForm() {
    setCliente(''); setClienteNombre(''); setClienteContacto(''); setClienteRut(''); setClienteDireccion(''); setClienteCorreo('')
    setFecha(today); setItems([nuevoItem()])
    setAplicaDescuento(false); setDescuentoPct(''); setCondiciones(CONDICIONES_DEFAULT)
    if (condicionesRef.current) condicionesRef.current.innerHTML = CONDICIONES_DEFAULT
    setNumeroEditado(false); setArchivoEditado(false)
    setIncluirTraslado(true); setTrasladoCantidad(1); setTrasladoValorEditado(false); setTrasladoTamano('13'); setTrasladoDescEditada(false)
  }

  // Guarda o enriquece el cliente en la base de clientes, para que la próxima vez que se
  // cotice a esta misma persona/empresa sus datos aparezcan solos. Es "best effort": si falla,
  // no interrumpe el guardado de la cotización (ya se guardó lo importante).
  async function guardarClienteSiCorresponde() {
    const empresaTrim = cliente.trim()
    const nombreTrim = clienteNombre.trim()
    if (!empresaTrim && !nombreTrim) return
    try {
      const existente = clientes.find(c =>
        (empresaTrim && (c.empresa || '').trim().toLowerCase() === empresaTrim.toLowerCase()) ||
        (nombreTrim && c.nombre.trim().toLowerCase() === nombreTrim.toLowerCase())
      )
      if (existente) {
        const cambios = {}
        if (!existente.empresa && empresaTrim) cambios.empresa = empresaTrim
        if (!existente.telefono && clienteContacto) cambios.telefono = clienteContacto
        if (!existente.rut && clienteRut) cambios.rut = clienteRut
        if (!existente.direccion && clienteDireccion) cambios.direccion = clienteDireccion
        if (!existente.correo && clienteCorreo) cambios.correo = clienteCorreo
        if (Object.keys(cambios).length) await supabase.from('clientes').update(cambios).eq('id', existente.id)
      } else {
        const etiqueta = nombreTrim || empresaTrim
        if (await confirm(`"${etiqueta}" es un cliente nuevo. ¿Quieres guardarlo en la lista de clientes para completar sus datos automáticamente la próxima vez?`)) {
          await supabase.from('clientes').insert({
            empresa: empresaTrim || null, nombre: nombreTrim || empresaTrim, telefono: clienteContacto || null,
            rut: clienteRut || null, direccion: clienteDireccion || null, correo: clienteCorreo || null,
          })
        }
      }
    } catch { /* no bloquea el flujo de la cotización */ }
  }

  async function guardarYDescargar() {
    if (!cliente.trim()) { toast('Escribe el nombre del cliente'); return }
    if (!items.length || items.some(it => !it.descripcion.trim())) { toast('Completa la descripción de cada ítem'); return }
    if (!numero || Number(numero) <= 0) { toast('El número de cotización no es válido'); return }
    setGuardando(true)
    const payload = {
      numero: Number(numero), cliente: cliente.trim(), cliente_rut: clienteRut || null,
      cliente_direccion: clienteDireccion || null, cliente_correo: clienteCorreo || null,
      cliente_nombre_contacto: clienteNombre.trim() || null, cliente_contacto: clienteContacto.trim() || null,
      // Tamaño y comuna del traslado cotizado — quedan guardados para poder sugerir el camión
      // correcto y precargar la comuna al confirmar la cotización y crear la reserva.
      tamano: incluirTraslado ? Number(trasladoTamano) : null, comuna: incluirTraslado ? (trasladoComuna || null) : null,
      fecha, items: itemsFinal, descuento_pct: aplicaDescuento ? Number(descuentoPct) || 0 : 0,
      subtotal, neto, iva, total, condiciones, estado: 'Pendiente', creado_por: perfil.id, creado_por_nombre: perfil.nombre,
    }
    const { error } = await supabase.from('cotizaciones').insert(payload)
    setGuardando(false)
    if (error) {
      toast(error.code === '23505' ? 'Ese número de cotización ya existe, cámbialo' : 'No se pudo guardar la cotización')
      return
    }
    await guardarClienteSiCorresponde()
    await generarPdfCotizacion(payload, nombreArchivo)
    resetForm(); reload(); toast('Cotización guardada y PDF generado')
  }

  async function marcarConfirmada(q) {
    const { error } = await supabase.from('cotizaciones').update({ estado: 'Confirmada' }).eq('id', q.id)
    if (error) { toast('No se pudo actualizar'); return }
    reload(); toast('Cotización confirmada')
    // Abre el formulario de nueva reserva precargado con los datos de la cotización — solo
    // falta confirmar (o cambiar) el camión sugerido y la fecha del servicio.
    if (openReservaDraft) {
      openReservaDraft({
        empresa: q.cliente || '',
        cliente: q.cliente_nombre_contacto || '',
        contacto: q.cliente_contacto || '',
        comuna: q.comuna || '',
        tamano: q.tamano || null,
      })
    }
  }

  async function deleteCotizacion(q) {
    if (!(await confirm(`¿Eliminar la cotización N° ${String(q.numero || 0).padStart(6, '0')} de "${q.cliente}"? Esto no se puede deshacer.`))) return
    const { error } = await supabase.from('cotizaciones').delete().eq('id', q.id)
    if (error) { toast('No se pudo eliminar la cotización'); return }
    toast('Cotización eliminada'); reload()
  }

  async function deleteSeleccionadas() {
    if (!seleccionadas.length) return
    if (!(await confirm(`¿Eliminar ${seleccionadas.length} cotización(es) seleccionada(s)? Esto no se puede deshacer.`))) return
    const { error } = await supabase.from('cotizaciones').delete().in('id', seleccionadas)
    if (error) { toast('No se pudieron eliminar las cotizaciones'); return }
    toast('Cotizaciones eliminadas'); setSeleccionadas([]); setSelectMode(false); reload()
  }

  const sorted = [...cotizaciones].sort((a, b) => (b.numero || 0) - (a.numero || 0))

  return (
    <>
      <div className="toolbar"><div><h1>Cotizaciones</h1><div className="section-sub">Arma una cotización detallada y descarga el PDF para enviar al cliente</div></div></div>
      <div className="card">
        <div className="card-head"><h2>Nueva cotización</h2></div>
        <div className="quick-row" style={{gridTemplateColumns:'0.6fr 1.1fr 1fr 1fr'}}>
          <div className="f-group"><label>N° de cotización</label><input type="text" inputMode="numeric" value={numero} onChange={e => onChangeNumero(e.target.value)} /></div>
          <div className="f-group"><label>Cliente</label>
            <input type="text" list="dl-clientes" value={cliente} onChange={e => onChangeCliente(e.target.value)} placeholder="Nombre cliente / empresa (se imprime en el PDF)" autoComplete="off" />
            <datalist id="dl-clientes">
              {[...new Set(clientes.flatMap(c => [c.empresa, c.nombre].filter(Boolean)))].map(v => <option key={v} value={v} />)}
            </datalist>
          </div>
          <div className="f-group"><label>Nombre cliente</label>
            <input type="text" list="dl-clientes-nombre" value={clienteNombre} onChange={e => onChangeClienteNombre(e.target.value)} placeholder="Persona de contacto (no sale en el PDF)" autoComplete="off" />
            <datalist id="dl-clientes-nombre">
              {clientes.map(c => <option key={c.id} value={c.nombre} />)}
            </datalist>
          </div>
          <div className="f-group"><label>Contacto</label><input type="text" value={clienteContacto} onChange={e => setClienteContacto(e.target.value)} placeholder="Nombre y/o teléfono" /></div>
        </div>
        <div className="quick-row" style={{gridTemplateColumns:'1fr 1fr 1fr'}}>
          <div className="f-group"><label>RUT</label><input type="text" value={clienteRut} onChange={e => setClienteRut(formatRut(e.target.value))} placeholder="Solo números, el formato se pone solo" /></div>
          <div className="f-group"><label>Dirección</label><input type="text" value={clienteDireccion} onChange={e => setClienteDireccion(e.target.value)} placeholder="Calle, número, comuna" /></div>
          <div className="f-group"><label>Correo</label><input type="text" value={clienteCorreo} onChange={e => setClienteCorreo(e.target.value)} placeholder="correo@cliente.cl" /></div>
        </div>
        <div className="quick-row" style={{gridTemplateColumns:'200px 1fr'}}>
          <div className="f-group"><label>Fecha</label><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></div>
          <div className="f-group"><label>Nombre del archivo PDF</label><input type="text" value={nombreArchivo} onChange={e => onChangeNombreArchivo(e.target.value)} /></div>
        </div>

        <div className="section-sub" style={{margin:'16px 0 8px'}}>Ítems</div>
        <table className="data items-table">
          <thead><tr><th>Descripción</th><th>Altura</th><th>Unidad</th><th>Cantidad</th><th>Valor unitario</th><th>Valor total</th><th></th></tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td className="desc-cell" data-label="Descripción"><textarea className="desc-input" value={it.descripcion} onChange={e => updateItem(i, 'descripcion', e.target.value)} placeholder="Arriendo de camión alza hombre de..." rows={3} /></td>
                <td data-label="Altura">
                  <select value={it.altura || ''} onChange={e => onChangeAltura(i, e.target.value)} style={{width:88}}>
                    <option value="">—</option>
                    <option value="13">13 m</option><option value="18">18 m</option><option value="20">20 m</option>
                  </select>
                </td>
                <td data-label="Unidad">
                  <select value={it.unidad} onChange={e => updateItem(i, 'unidad', e.target.value)}>
                    <option value="Hora">Hora</option><option value="Día">Día</option><option value="Semana">Semana</option>
                  </select>
                </td>
                <td data-label="Cantidad"><input type="text" inputMode="numeric" value={it.cantidad} onChange={e => updateItem(i, 'cantidad', e.target.value.replace(/[^\d]/g, ''))} style={{width:70}} /></td>
                <td data-label="Valor unitario"><input type="text" inputMode="numeric" value={fmtInputMoney(it.valorUnit)} onChange={e => updateItem(i, 'valorUnit', parseMoneyInput(e.target.value))} style={{width:110}} /></td>
                <td className="mono" data-label="Valor total">{fmtMoney((Number(it.cantidad) || 0) * (Number(it.valorUnit) || 0))}</td>
                <td>{items.length > 1 && <button className="btn-danger btn-sm" onClick={() => removeItem(i)}>×</button>}</td>
              </tr>
            ))}
            {incluirTraslado && (
              <tr style={{background:'var(--bg2, #fafafa)'}}>
                <td className="desc-cell" data-label="Descripción"><textarea className="desc-input" value={trasladoDescripcion} onChange={e => onChangeTrasladoDescripcion(e.target.value)} rows={3} /></td>
                <td data-label="Altura"><span className="mono">—</span></td>
                <td data-label="Unidad"><span className="mono">un</span></td>
                <td data-label="Cantidad"><input type="text" inputMode="numeric" value={trasladoCantidad} onChange={e => setTrasladoCantidad(e.target.value.replace(/[^\d]/g, ''))} style={{width:70}} /></td>
                <td data-label="Valor unitario"><input type="text" inputMode="numeric" value={fmtInputMoney(trasladoValor)} onChange={e => onChangeTrasladoValor(e.target.value)} style={{width:110}} /></td>
                <td className="mono" data-label="Valor total">{fmtMoney((Number(trasladoCantidad) || 0) * (Number(trasladoValor) || 0))}</td>
                <td><button className="btn-danger btn-sm" onClick={() => setIncluirTraslado(false)}>×</button></td>
              </tr>
            )}
          </tbody>
        </table>
        <div style={{display:'flex', gap:8, marginTop:8}}>
          <button className="btn-outline btn-sm" onClick={addItem}>+ Agregar ítem</button>
          {!incluirTraslado && <button className="btn-outline btn-sm" onClick={() => setIncluirTraslado(true)}>+ Agregar traslado</button>}
        </div>

        {incluirTraslado && (
          <div className="quick-row" style={{gridTemplateColumns:'1fr 1fr', marginTop:12}}>
            <div className="f-group"><label>Traslado · tamaño de camión (para sugerir el valor)</label>
              <select value={trasladoTamano} onChange={e => setTrasladoTamano(e.target.value)}>
                <option value="13">13 metros</option><option value="18">18 metros</option><option value="20">20 metros</option>
              </select>
            </div>
            <div className="f-group"><label>Traslado · comuna de destino</label>
              <input type="text" list="dl-comunas-cotizacion" value={trasladoComuna} onChange={e => setTrasladoComuna(e.target.value)} placeholder="Escribe para buscar…" autoComplete="off" />
              <datalist id="dl-comunas-cotizacion">
                {tarifasComunas.map(c => <option key={c.id} value={c.comuna} />)}
              </datalist>
            </div>
          </div>
        )}

        <div style={{marginTop:16, display:'flex', alignItems:'center', gap:10}}>
          <label style={{display:'flex', alignItems:'center', gap:6, fontSize:13.5}}>
            <input type="checkbox" checked={aplicaDescuento} onChange={e => setAplicaDescuento(e.target.checked)} /> Aplicar descuento
          </label>
          {aplicaDescuento && (
            <input type="text" inputMode="numeric" value={descuentoPct} onChange={e => setDescuentoPct(e.target.value.replace(/[^\d]/g, ''))} style={{width:70}} placeholder="%" />
          )}
        </div>

        <div className="f-group" style={{marginTop:16}}><label>Condiciones comerciales</label>
          <div className="section-sub" style={{margin:'-2px 0 8px'}}>Selecciona un texto y usa los botones para ponerlo en negrita o cambiarle el color, como en Word. Los bloques que quedan completos en negrita se muestran como título azul en el PDF.</div>
          <div className="rte-toolbar">
            <button type="button" className="rte-btn" title="Negrita" onMouseDown={e => e.preventDefault()} onClick={() => execRte('bold')}><b>N</b></button>
            <label className="rte-btn rte-color-btn" title="Color de letra" onMouseDown={saveSelection}>
              A
              <input type="color" defaultValue="#002060" onChange={e => setCondicionesColor(e.target.value)} />
            </label>
            <button type="button" className="rte-btn" title="Quitar formato" onMouseDown={e => e.preventDefault()} onClick={() => execRte('removeFormat')}>Limpiar</button>
          </div>
          <div
            ref={condicionesRef}
            className="rte-editor"
            contentEditable
            suppressContentEditableWarning
            onInput={e => setCondiciones(e.currentTarget.innerHTML)}
            onMouseUp={saveSelection}
            onKeyUp={saveSelection}
          />
        </div>

        <div className="result-box" style={{marginTop:16}}>
          <div className="result-grid">
            <div className="rl">Subtotal neto</div><div className="rv">{fmtMoney(subtotal)}</div>
            {aplicaDescuento && <><div className="rl">Descuento ({descuentoPct || 0}%)</div><div className="rv">- {fmtMoney(descuento)}</div></>}
            <div className="rl">Total neto</div><div className="rv">{fmtMoney(neto)}</div>
            <div className="rl">IVA (19%)</div><div className="rv">{fmtMoney(iva)}</div>
          </div>
          <div className="result-total"><span className="rt-lbl">Total</span><span className="rt-val">{fmtMoney(total)}</span></div>
          <div style={{marginTop:12}}><button className="btn-orange btn-sm" disabled={guardando} onClick={guardarYDescargar}>{guardando ? 'Guardando…' : 'Guardar y descargar PDF'}</button></div>
        </div>
      </div>

      <div className="card" style={{padding:0}}>
        <div className="card-head" style={{padding:'18px 18px 0'}}>
          <h2>Cotizaciones guardadas</h2>
          <div style={{display:'flex',gap:8}}>
            {selectMode && seleccionadas.length > 0 && (
              <button className="btn-danger btn-sm" onClick={deleteSeleccionadas}>Eliminar seleccionadas ({seleccionadas.length})</button>
            )}
            <button className="btn-outline btn-sm" onClick={toggleSelectMode}>{selectMode ? 'Cancelar selección' : 'Seleccionar varias'}</button>
          </div>
        </div>
        <table className="data">
          <thead><tr>{selectMode && <th></th>}<th>N°</th><th>Cliente</th><th>Fecha</th><th>Total</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {!sorted.length && <tr><td colSpan={selectMode ? 7 : 6} style={{textAlign:'center',color:'var(--mute2)',padding:24}}>Aún no hay cotizaciones guardadas.</td></tr>}
            {sorted.map(q => (
              <tr key={q.id}>
                {selectMode && (
                  <td><input type="checkbox" checked={seleccionadas.includes(q.id)} onChange={() => toggleSeleccionada(q.id)} /></td>
                )}
                <td className="mono">{String(q.numero || 0).padStart(6, '0')}</td>
                <td>
                  <strong>{q.cliente}</strong>
                  {q.creado_por_nombre && <div style={{fontSize:11,color:'var(--mute2)',marginTop:2}}>Emitida por: {q.creado_por_nombre}</div>}
                </td>
                <td className="mono">{new Date(q.fecha + 'T00:00:00').toLocaleDateString('es-CL')}</td>
                <td className="mono"><strong>{fmtMoney(q.total)}</strong></td>
                <td><span className={`tag ${q.estado === 'Confirmada' ? 'st-trabajo' : 'st-pendiente'}`}>{q.estado}</span></td>
                <td style={{display:'flex',gap:6}}>
                  <button className="btn-outline btn-sm" onClick={() => generarPdfCotizacion(q)}>Descargar PDF</button>
                  {q.estado === 'Pendiente' && <button className="btn-dark btn-sm" onClick={() => marcarConfirmada(q)}>Marcar confirmada</button>}
                  <button className="btn-danger btn-sm" onClick={() => deleteCotizacion(q)}>Eliminar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
