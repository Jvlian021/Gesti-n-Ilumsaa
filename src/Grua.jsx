import { useEffect, useMemo, useRef, useState } from 'react'
import { isoDate, fmtMoney, fmtInputMoney, parseMoneyInput, formatRut } from './helpers.js'

// ============================================================
// Grúa cama baja: calculador de traslados + cotización
// ------------------------------------------------------------
// Dos formas de llegar al precio:
//  - "Costo + utilidad": se estima lo que cuesta el viaje (petróleo, conductor, desgaste,
//    gastos fijos) y se le suma la utilidad que se quiera ganar.
//  - "Tarifa por km": cargo de salida + km con carga + km vacío (lo típico del rubro).
// En ambos se suman recargos (según lo que se traslada, horario, emergencia), maniobra
// especial, espera adicional y peajes.
//
// Los km se calculan solos: las direcciones se buscan en Photon (OpenStreetMap) y la ruta en
// OSRM. Ambos son servicios públicos gratuitos, sin clave ni costo, pero sin garantía de
// disponibilidad: si fallan, se avisa y los km se escriben a mano.
//
// Por ahora las tarifas ajustadas se guardan en el navegador (localStorage) y la cotización solo
// se descarga en PDF, no se guarda en la base. Pendiente: tabla de tarifas compartida en Supabase,
// guardar las cotizaciones de grúa y conectarlas con el calendario.
// ============================================================

const PARAMS_KEY = 'ilumsa-grua-params-v1'

// Valores de partida para probar: NO son precios de mercado confirmados.
const PARAMS_DEFAULT = {
  modo: 'tarifa',         // 'utilidad' | 'tarifa'
  utilidad: 70,           // % que se gana sobre el costo del viaje
  // Tarifa por km calibrada por Julián a partir de 2 cotizaciones reales (oct 2026, Puente Alto →
  // Maipú, ~57 km: $55.000 y $70.000 sin IVA).
  salida: 25000,          // tarifa por km: cargo fijo por servicio
  kmCargado: 1200,        // tarifa por km: $ por km con el vehículo arriba
  kmVacio: 600,           // tarifa por km: $ por km sin carga
  minimo: 60000,          // ningún servicio se cobra bajo este valor
  recargoNocturno: 30,    // % noche o fin de semana
  recargoFestivo: 50,     // % festivo
  recargoEmergencia: 20,  // % salida inmediata
  // Maniobras según el estado del vehículo (se suman las que apliquen)
  recNoRueda: 20000,      // le faltan ruedas, bloqueadas o frenos pegados
  recSinLlaves: 15000,    // sin llaves o no queda en neutro
  recSiniestro: 30000,    // chocado o volcado
  recAcceso: 15000,       // subterráneo, pendiente fuerte o espacio reducido
  esperaLibreMin: 30,     // minutos de espera incluidos
  esperaHora: 15000,      // $ por hora de espera adicional
  extraAuto: 0, extraCamioneta: 15, extraFurgon: 30, extraMaquinaria: 25, // % extra según lo que se traslada
  // Costos internos (no salen en la cotización)
  rendimiento: 6,         // km por litro de la grúa
  diesel: 1000,           // $ por litro
  conductorHora: 7000,    // $ por hora de conductor (sueldo + leyes sociales)
  velocidad: 40,          // km/h promedio
  horasManiobra: 0.75,    // horas de carga/descarga por viaje
  desgasteKm: 150,        // $ por km (neumáticos, mantención, repuestos)
  gastoFijoViaje: 0,      // seguro, permisos, cuota de la grúa… repartidos por viaje
  // Punto exacto de la base (Argentina 821, La Cisterna), marcado a mano por Julián
  baseLugar: { label: 'Argentina 821, La Cisterna', lat: -33.5294536, lon: -70.6530198, exacto: true, ajustado: true },
}

const CARGAS = [
  { key: 'auto', label: 'Auto / city car', extra: 'extraAuto', texto: 'automóvil' },
  { key: 'camioneta', label: 'Camioneta / SUV', extra: 'extraCamioneta', texto: 'camioneta' },
  { key: 'furgon', label: 'Furgón / utilitario', extra: 'extraFurgon', texto: 'furgón' },
  { key: 'maquinaria', label: 'Maquinaria', extra: 'extraMaquinaria', texto: 'maquinaria' },
]

// Preguntas que se le hacen al cliente sobre el vehículo. Cada una suma su propio recargo.
const ESTADOS = [
  { key: 'noRueda', label: '¿No rueda?', detalle: 'Le faltan ruedas, están bloqueadas o tiene los frenos pegados', param: 'recNoRueda', pdf: 'vehículo que no rueda', cond: 'no rueda' },
  { key: 'sinLlaves', label: '¿Sin llaves o no queda en neutro?', detalle: 'No se puede mover la dirección ni soltar la caja', param: 'recSinLlaves', pdf: 'vehículo sin llaves o sin neutro', cond: 'sin llaves o sin neutro' },
  { key: 'siniestrado', label: '¿Chocado o volcado?', detalle: 'Requiere maniobra de rescate o enderezado', param: 'recSiniestro', pdf: 'vehículo chocado o volcado', cond: 'chocado o volcado' },
  { key: 'acceso', label: '¿Acceso difícil?', detalle: 'Subterráneo, pendiente fuerte o espacio reducido', param: 'recAcceso', pdf: 'acceso difícil (subterráneo o espacio reducido)', cond: 'acceso difícil' },
]

const HORARIOS = [
  { key: 'habil', label: 'Hábil' },
  { key: 'nocturno', label: 'Noche / fin de semana' },
  { key: 'festivo', label: 'Festivo' },
]

function condicionesDefault(p) {
  return [
    'Condiciones Comerciales:',
    'Reserva del servicio: se confirma con Orden de Compra o abono del 50%; el saldo se paga al término del traslado.',
    'Recorrido: el valor considera el recorrido indicado. Desvíos, cambios de destino o kilómetros adicionales se cobran según tarifa vigente.',
    `Tiempo de espera: incluye ${p.esperaLibreMin} minutos en el punto de retiro y de entrega. El tiempo adicional se cobra a ${fmtMoney(p.esperaHora)} + IVA por hora.`,
    'Validez: esta cotización tiene una validez de 15 días.',
    'Condiciones del Traslado:',
    'Estado del vehículo: se registra con fotografías al momento de la carga. Los daños preexistentes no son responsabilidad de la empresa.',
    'Objetos personales: el cliente debe retirar sus objetos de valor; la empresa no responde por objetos dejados en el vehículo.',
    'Acceso: el vehículo debe estar en un lugar accesible para la grúa. Maniobras en subterráneos, pendientes o espacios reducidos pueden tener recargo.',
    'Condición informada: el valor considera el estado del vehículo informado por el cliente (ruedas, llaves, daños y acceso). Si al llegar es distinto, se cobrará la maniobra adicional que corresponda.',
    'Cancelaciones:',
    'Si la grúa ya salió hacia el punto de retiro, se cobrará el valor de la salida.',
  ].join('\n')
}

function leerParams() {
  try {
    const raw = localStorage.getItem(PARAMS_KEY)
    if (!raw) return PARAMS_DEFAULT
    const guardado = JSON.parse(raw)
    // Versión anterior guardaba "factor" en base 100 (115 = +15%): se convierte a "+%".
    for (const [viejo, nuevo] of [['factorAuto', 'extraAuto'], ['factorCamioneta', 'extraCamioneta'], ['factorFurgon', 'extraFurgon'], ['factorMaquinaria', 'extraMaquinaria']]) {
      if (guardado[viejo] != null && guardado[nuevo] == null) guardado[nuevo] = Number(guardado[viejo]) - 100
      delete guardado[viejo]
    }
    // Tarifa por km de la primera versión (muy cara frente al mercado): se reemplaza por la calibrada.
    if (guardado.salida === 40000 && guardado.kmCargado === 1500 && guardado.kmVacio === 700) {
      guardado.salida = PARAMS_DEFAULT.salida; guardado.kmCargado = PARAMS_DEFAULT.kmCargado; guardado.kmVacio = PARAMS_DEFAULT.kmVacio
    }
    delete guardado.maniobra
    return { ...PARAMS_DEFAULT, ...guardado }
  } catch { return PARAMS_DEFAULT }
}

function num(v) { return Number(String(v).replace(',', '.')) || 0 }
function redondeoMil(v) { return Math.round(v / 1000) * 1000 }

// ---------- Mapas (servicios gratuitos de OpenStreetMap) ----------
const CHILE_BBOX = '-76,-56,-66,-17'

function etiquetaLugar(pr) {
  const calle = pr.street ? `${pr.street}${pr.housenumber ? ' ' + pr.housenumber : ''}` : ''
  const comuna = pr.district || pr.city || pr.county || ''
  const partes = [pr.name && pr.name !== pr.street ? pr.name : '', calle, comuna !== pr.name ? comuna : ''].filter(Boolean)
  return [...new Set(partes)].join(', ')
}

async function buscarDirecciones(texto, signal) {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(texto)}&limit=5&lat=-33.45&lon=-70.65&bbox=${CHILE_BBOX}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error('photon ' + res.status)
  const data = await res.json()
  // `exacto` = se encontró el número de la dirección (si no, es un punto cualquiera de la calle)
  return (data.features || []).map(f => ({
    label: etiquetaLugar(f.properties), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
    exacto: !!f.properties.housenumber || !['street', 'district', 'city', 'county', 'state', 'locality'].includes(f.properties.type),
  }))
}

// Minúsculas, sin tildes ni apóstrofos (O´Higgins / O'Higgins / OHiggins calzan igual).
function normalizar(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[´'`’]/g, '').toLowerCase()
}

// Devuelve los km de cada tramo entre los puntos dados (en orden).
async function calcularTramos(puntos, signal) {
  const coords = puntos.map(p => `${p.lon},${p.lat}`).join(';')
  const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`, { signal })
  if (!res.ok) throw new Error('osrm ' + res.status)
  const data = await res.json()
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error('osrm sin ruta')
  return data.routes[0].legs.map(l => Math.round(l.distance / 100) / 10)
}

// Campo de dirección con sugerencias. La primera opción de la lista siempre es lo escrito tal
// cual (con número), para que salga completo en la cotización y en Google Maps. Los km se
// calculan con el punto más cercano que encuentre el buscador; si no encontró el número,
// se avisa que los km son aproximados.
function DireccionInput({ label, lugar, onChange, placeholder }) {
  const [texto, setTexto] = useState(lugar?.label || '')
  const [sugerencias, setSugerencias] = useState([])
  const [abierto, setAbierto] = useState(false)
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState('')
  const editadoRef = useRef(false)

  useEffect(() => { if (!editadoRef.current) setTexto(lugar?.label || '') }, [lugar])

  useEffect(() => {
    if (!editadoRef.current) return
    const q = texto.trim()
    if (q.length < 3) { setSugerencias([]); return }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      setBuscando(true); setError('')
      try {
        const r = await buscarDirecciones(q, ctrl.signal)
        // Si lo escrito no calza con ninguna sugerencia exacta, se ofrece tal cual como primera opción.
        const yaEsta = r.some(s => normalizar(s.label) === normalizar(q))
        // Para los km se usa un resultado de la MISMA calle escrita (no otra calle con el mismo número).
        const calle = s => normalizar(s.label.split(',')[0].replace(/\d+/g, '')).trim()
        const mismaCalle = r.filter(s => calle(s) && normalizar(q).includes(calle(s)))
        const numeroQ = (q.match(/\d+/) || [])[0]
        const conNumero = mismaCalle.find(s => s.exacto && numeroQ && s.label.includes(numeroQ))
        const puntoKm = conNumero || mismaCalle[0] || r[0]
        const propia = r.length && !yaEsta ? [{ ...puntoKm, label: q, exacto: !!conNumero, propia: true }] : []
        setSugerencias([...propia, ...r]); setAbierto(true)
      } catch (e) {
        if (e.name !== 'AbortError') setError('No se pudo buscar la dirección. Escribe los km a mano.')
      }
      setBuscando(false)
    }, 450)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [texto])

  function elegir(s) {
    editadoRef.current = false
    setTexto(s.label); setSugerencias([]); setAbierto(false)
    onChange(s)
  }

  return (
    <div className="f-group dir-input">
      <label>{label}</label>
      <div className="grua-input">
        <input
          type="text" value={texto} placeholder={placeholder} autoComplete="off"
          onChange={e => { editadoRef.current = true; setTexto(e.target.value); onChange(null) }}
          onFocus={() => sugerencias.length && setAbierto(true)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
        />
        <span className="suf">{buscando ? '…' : lugar ? '✓' : ''}</span>
      </div>
      {abierto && sugerencias.length > 0 && (
        <div className="dir-sugerencias">
          {sugerencias.map((s, i) => (
            <button key={i} type="button" className={s.propia ? 'propia' : ''} onMouseDown={e => e.preventDefault()} onClick={() => elegir(s)}>
              {s.propia ? <>Usar <strong>{s.label}</strong></> : s.label}
            </button>
          ))}
        </div>
      )}
      {abierto && !buscando && !sugerencias.length && texto.trim().length >= 3 && !error && (
        <div className="dir-sugerencias"><div className="dir-vacio">Sin resultados. Prueba con calle, número y comuna.</div></div>
      )}
      {error && <div className="f-hint warn">{error}</div>}
      {!lugar && texto.trim() && !error && <div className="f-hint">Elige una opción de la lista para calcular los km.</div>}
      {lugar && !lugar.exacto && !lugar.ajustado && <div className="f-hint warn">No se encontró el número exacto: los km son aproximados. Revísalos en Google Maps.</div>}
    </div>
  )
}

// Campo numérico simple. `money` muestra separador de miles; si no, acepta decimales.
function Campo({ label, value, onChange, money, prefix, suffix, hint, placeholder }) {
  return (
    <div className="f-group">
      <label>{label}</label>
      <div className="grua-input">
        {(money || prefix) && <span className="pre">{prefix || '$'}</span>}
        <input
          type="text" inputMode={money ? 'numeric' : 'decimal'} placeholder={placeholder}
          value={money ? fmtInputMoney(value) : value}
          onChange={e => onChange(money ? parseMoneyInput(e.target.value) : e.target.value.replace(/[^\d.,]/g, ''))}
        />
        {suffix && <span className="suf">{suffix}</span>}
      </div>
      {hint && <div className="f-hint">{hint}</div>}
    </div>
  )
}

export default function Grua({ cotizaciones = [], clientes = [], toast = () => {}, generarPdf, baseDireccion = '' }) {
  const [p, setP] = useState(leerParams)
  useEffect(() => { try { localStorage.setItem(PARAMS_KEY, JSON.stringify(p)) } catch { /* sin almacenamiento */ } }, [p])
  function setParam(k, v) { setP(prev => ({ ...prev, [k]: v })) }
  const [verTarifas, setVerTarifas] = useState(false)

  // ---------- Servicio ----------
  const [tipo, setTipo] = useState('externo') // 'externo' = vehículo de un cliente · 'alzahombres' = nuestro equipo
  const [carga, setCarga] = useState('auto')
  // La base queda guardada con su ubicación, para no buscarla cada vez
  const [base, setBase] = useState(() => leerParams().baseLugar || null)
  useEffect(() => { if (base) setP(prev => ({ ...prev, baseLugar: base })) }, [base])
  const [origen, setOrigen] = useState(null)
  const [destino, setDestino] = useState(null)
  const [kmIda, setKmIda] = useState('')       // base → retiro (vacío)
  const [kmCarga, setKmCarga] = useState('')   // retiro → entrega (con carga)
  const [kmVuelta, setKmVuelta] = useState('') // entrega → base (vacío)
  const [rutaEstado, setRutaEstado] = useState('') // '', 'calculando', 'ok', 'error', 'manual'
  const [horario, setHorario] = useState('habil')
  const [emergencia, setEmergencia] = useState(false)
  const [estado, setEstado] = useState({}) // { noRueda: true, ... } según lo que informe el cliente
  const [esperaMin, setEsperaMin] = useState('')
  const [peajes, setPeajes] = useState(0)
  const [conRetiro, setConRetiro] = useState(true) // alza hombres: llevar y volver a buscar = 2 viajes

  const esAlza = tipo === 'alzahombres'
  const cargaEf = esAlza ? 'maquinaria' : carga

  // La base parte con la dirección de la empresa ya ubicada en el mapa.
  useEffect(() => {
    if (!baseDireccion || base) return
    const ctrl = new AbortController()
    buscarDirecciones(baseDireccion, ctrl.signal)
      .then(r => { if (r[0]) setBase({ ...r[0], label: baseDireccion }) })
      .catch(() => {})
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseDireccion])

  // Km automáticos: cuando base, retiro y entrega están ubicados, se calcula la ruta completa.
  useEffect(() => {
    const puntos = esAlza ? [base, destino, base] : [base, origen, destino, base]
    if (puntos.some(x => !x)) { setRutaEstado(''); return }
    const ctrl = new AbortController()
    setRutaEstado('calculando')
    calcularTramos(puntos, ctrl.signal)
      .then(legs => {
        if (esAlza) { setKmCarga(String(legs[0])); setKmVuelta(String(legs[1])) }
        else { setKmIda(String(legs[0])); setKmCarga(String(legs[1])); setKmVuelta(String(legs[2])) }
        setRutaEstado('ok')
      })
      .catch(e => { if (e.name !== 'AbortError') setRutaEstado('error') })
    return () => ctrl.abort()
  }, [base, origen, destino, esAlza])

  function kmManual(setter) { return v => { setter(v); if (rutaEstado === 'ok') setRutaEstado('manual') } }

  // ---------- Cálculo ----------
  const c = useMemo(() => {
    const k1 = esAlza ? 0 : num(kmIda)
    const k2 = num(kmCarga)
    const k3 = num(kmVuelta)
    const kmVacio = k1 + k3
    const kmTotal = k1 + k2 + k3
    const viajes = esAlza && conRetiro ? 2 : 1
    const cargaDef = CARGAS.find(x => x.key === cargaEf)
    const extraCargaPct = num(p[cargaDef.extra])

    // Costo del viaje (por viaje)
    const combustible = num(p.rendimiento) > 0 ? kmTotal / num(p.rendimiento) * num(p.diesel) : 0
    const horasViaje = (num(p.velocidad) > 0 ? kmTotal / num(p.velocidad) : 0) + num(p.horasManiobra)
    const horas = horasViaje + num(esperaMin) / 60
    const conductor = horas * num(p.conductorHora)
    const desgaste = kmTotal * num(p.desgasteKm)
    const fijo = num(p.gastoFijoViaje)
    const vPeajes = num(peajes)
    // Lo que cuesta mover la grúa (sin espera ni peajes, que se cobran aparte)
    const costoOperacion = combustible + horasViaje * num(p.conductorHora) + desgaste + fijo

    // Base del servicio según el método elegido
    const baseTarifa = num(p.salida) + k2 * num(p.kmCargado) + kmVacio * num(p.kmVacio)
    const baseUtilidad = costoOperacion * (1 + num(p.utilidad) / 100)
    const calcServicio = (b) => {
      const conCarga = b * (1 + extraCargaPct / 100)
      const recargoPct = (horario === 'nocturno' ? num(p.recargoNocturno) : horario === 'festivo' ? num(p.recargoFestivo) : 0)
        + (emergencia ? num(p.recargoEmergencia) : 0)
      const conRecargos = conCarga * (1 + recargoPct / 100)
      const aplicaMinimo = conRecargos < num(p.minimo)
      return { b, conCarga, recargoPct, conRecargos, aplicaMinimo, servicio: redondeoMil(aplicaMinimo ? num(p.minimo) : conRecargos) }
    }
    const sT = calcServicio(baseTarifa)
    const sU = calcServicio(baseUtilidad)
    const s = p.modo === 'tarifa' ? sT : sU
    const otro = p.modo === 'tarifa' ? sU : sT

    const esperaExtraMin = Math.max(0, num(esperaMin) - num(p.esperaLibreMin))
    const espera = redondeoMil(esperaExtraMin / 60 * num(p.esperaHora))
    const maniobras = esAlza ? [] : ESTADOS.filter(e => estado[e.key]).map(e => ({ ...e, valor: num(p[e.param]) }))
    const vManiobra = maniobras.reduce((s, m) => s + m.valor, 0)

    const porViaje = s.servicio + vManiobra + espera + vPeajes
    const neto = porViaje * viajes
    const conductorEspera = num(esperaMin) / 60 * num(p.conductorHora)
    const costoViaje = costoOperacion + conductorEspera + vPeajes
    const costo = costoViaje * viajes
    const ganancia = neto - costo
    const margenPct = neto > 0 ? ganancia / neto * 100 : 0
    const sobreCostoPct = costo > 0 ? ganancia / costo * 100 : 0

    return {
      k1, k2, k3, kmVacio, kmTotal, viajes, extraCargaPct, ...s, otroServicio: otro.servicio,
      esperaExtraMin, espera, maniobras, vManiobra, vPeajes, porViaje, neto,
      combustible, horas, horasViaje, conductor, conductorEspera, desgaste, fijo, costoOperacion, costoViaje, costo, ganancia, margenPct, sobreCostoPct,
    }
  }, [p, esAlza, kmIda, kmCarga, kmVuelta, conRetiro, cargaEf, horario, emergencia, estado, esperaMin, peajes])

  const faltanKm = !c.k2 || (!esAlza && !c.k1) || !c.k3

  // Ruta completa en Google Maps, para revisar el recorrido a ojo.
  function abrirRuta() {
    const enc = encodeURIComponent
    const paradas = esAlza ? [destino] : [origen, destino]
    if (!base || paradas.some(x => !x)) { toast('Elige base, retiro y entrega de la lista para ver la ruta'); return }
    // Se manda la dirección escrita (con número) para que Google ubique el punto exacto; la base
    // va por coordenadas si quedó marcada en un punto preciso.
    const dir = x => x.ajustado ? `${x.lat},${x.lon}` : (/chile/i.test(x.label) ? x.label : `${x.label}, Chile`)
    const url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${enc(dir(base))}&destination=${enc(dir(base))}&waypoints=${enc(paradas.map(dir).join('|'))}`
    window.open(url, '_blank', 'noopener')
  }

  // ---------- Cotización ----------
  const ultimaCreada = [...cotizaciones].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0]
  const nextNumero = (ultimaCreada?.numero || 0) + 1
  const [numero, setNumero] = useState('')
  const numeroEf = numero || String(nextNumero)
  const [cliente, setCliente] = useState('')
  const [clienteRut, setClienteRut] = useState('')
  const [clienteDireccion, setClienteDireccion] = useState('')
  const [clienteCorreo, setClienteCorreo] = useState('')
  const [fecha, setFecha] = useState(isoDate(new Date()))
  const [condiciones, setCondiciones] = useState(() => condicionesDefault(leerParams()))
  const [generando, setGenerando] = useState(false)

  function onChangeCliente(valor) {
    setCliente(valor)
    const m = clientes.find(x => (x.empresa || '').trim().toLowerCase() === valor.trim().toLowerCase() || (x.nombre || '').trim().toLowerCase() === valor.trim().toLowerCase())
    if (m) {
      if (m.rut) setClienteRut(m.rut)
      if (m.direccion) setClienteDireccion(m.direccion)
      if (m.correo) setClienteCorreo(m.correo)
    }
  }

  function armarItems() {
    const cargaTxt = CARGAS.find(x => x.key === cargaEf).texto
    const horarioTxt = horario === 'habil' ? '' : ` Servicio en horario ${horario === 'festivo' ? 'festivo' : 'nocturno / fin de semana'}.`
    const emergTxt = emergencia ? ' Salida inmediata (emergencia).' : ''
    const estadoTxt = c.maniobras.length ? ` Condición informada del vehículo: ${c.maniobras.map(m => m.cond).join(', ')}.` : ''
    const principal = esAlza
      ? `Traslado de equipo alza hombre en grúa cama baja desde nuestras instalaciones hasta ${destino?.label || '—'}${c.viajes === 2 ? ' (llevada y retiro: 2 viajes)' : ''}. Recorrido aprox. ${Math.round(c.kmTotal)} km por viaje. Incluye conductor, combustible y peajes.${horarioTxt}${emergTxt}`
      : `Servicio de traslado de ${cargaTxt} en grúa cama baja desde ${origen?.label || '—'} hasta ${destino?.label || '—'} (aprox. ${Math.round(c.k2)} km con carga). Incluye conductor, combustible y peajes.${horarioTxt}${emergTxt}${estadoTxt}`
    // Las maniobras por el estado del vehículo y los peajes van incluidos en el valor del servicio
    // (no como ítem aparte, para no generar reclamos); solo se menciona la condición informada.
    const items = [{ descripcion: principal, unidad: 'Servicio', cantidad: c.viajes, valorUnit: c.servicio + c.vManiobra + c.vPeajes }]
    if (c.espera) items.push({ descripcion: `Tiempo de espera adicional (${c.esperaExtraMin} min sobre los ${num(p.esperaLibreMin)} min incluidos).`, unidad: 'un', cantidad: c.viajes, valorUnit: c.espera })
    return items
  }

  // ---------- Ítems editables ----------
  // Mientras no se toquen, los ítems siguen al calculador. Al editar uno (o agregar/borrar) se
  // copian y quedan fijos; si después cambia el cálculo, se avisa y se pueden actualizar.
  const itemsAuto = armarItems()
  const itemsAutoJson = JSON.stringify(itemsAuto)
  const [itemsEdit, setItemsEdit] = useState(null)
  const [snapshotAuto, setSnapshotAuto] = useState('')
  const items = itemsEdit || itemsAuto
  const editado = itemsEdit !== null
  const calculoCambio = editado && snapshotAuto !== itemsAutoJson
  function cambiarItems(fn) {
    if (!editado) setSnapshotAuto(itemsAutoJson)
    setItemsEdit(fn(itemsEdit || itemsAuto))
  }
  function editarItem(i, campo, valor) { cambiarItems(rows => rows.map((r, idx) => idx === i ? { ...r, [campo]: valor } : r)) }
  function agregarItem() { cambiarItems(rows => [...rows, { descripcion: '', unidad: 'un', cantidad: 1, valorUnit: 0 }]) }
  function borrarItem(i) { cambiarItems(rows => rows.filter((_, idx) => idx !== i)) }
  function volverAlCalculo() { setItemsEdit(null); setSnapshotAuto('') }

  // Lo que realmente se cotiza es la suma de los ítems (calculados o editados a mano).
  const netoCot = items.reduce((s, it) => s + (Number(it.cantidad) || 0) * (Number(it.valorUnit) || 0), 0)
  const ganancia = netoCot - c.costo
  const margenPct = netoCot > 0 ? ganancia / netoCot * 100 : 0
  const sobreCostoPct = c.costo > 0 ? ganancia / c.costo * 100 : 0

  async function descargarPdf() {
    if (!cliente.trim()) { toast('Escribe el nombre del cliente'); return }
    if (!items.length || items.some(it => !String(it.descripcion).trim())) { toast('Completa la descripción de cada ítem'); return }
    if (!editado && faltanKm) { toast('Faltan los km de algún tramo'); return }
    if (!generarPdf) { toast('PDF no disponible en esta vista'); return }
    setGenerando(true)
    try {
      const neto = netoCot, iva = neto * 0.19
      const q = {
        numero: Number(numeroEf), cliente: cliente.trim(), cliente_rut: clienteRut || null,
        cliente_direccion: clienteDireccion || null, cliente_correo: clienteCorreo || null,
        fecha, items, descuento_pct: 0, subtotal: neto, neto, iva, total: neto + iva, condiciones,
      }
      const cli = cliente.trim().toUpperCase().replace(/[^A-ZÁÉÍÓÚÑ0-9 ]+/g, '').replace(/ +/g, ' ')
      await generarPdf(q, `PPTO${String(numeroEf).padStart(4, '0')}_GRUA_${cli}`)
      toast('PDF generado (vista previa: no se guardó)')
    } catch { toast('No se pudo generar el PDF') }
    setGenerando(false)
  }

  const margenClase = margenPct >= 35 ? 'ok' : margenPct >= 20 ? 'medio' : 'bajo'
  const extraLabel = v => (num(v) > 0 ? `+${num(v)}%` : 'sin recargo')

  return (
    <>
      <div className="toolbar"><div>
        <h1>Grúa · traslados</h1>
        <div className="section-sub">Calcula el valor de un traslado en grúa cama baja y genera la cotización</div>
      </div></div>

      <div className="grua-preview-note">Los ajustes de tarifas se guardan en este dispositivo. Por ahora la cotización de grúa se descarga en PDF, pero aún no queda en el historial de cotizaciones.</div>

      <div className="grua-layout">
        <div>
          <div className="card">
            <div className="card-head"><h2>1 · ¿Qué se traslada?</h2></div>
            <div className="seg">
              <button className={tipo === 'externo' ? 'on' : ''} onClick={() => setTipo('externo')}>
                Vehículo de un cliente<small>Emergencias, panas, traslados</small>
              </button>
              <button className={tipo === 'alzahombres' ? 'on' : ''} onClick={() => setTipo('alzahombres')}>
                Nuestro alza hombres<small>Llevarlo a la obra y retirarlo</small>
              </button>
            </div>
            {!esAlza && (
              <div className="seg seg-sm" style={{marginTop:10}}>
                {CARGAS.map(x => (
                  <button key={x.key} className={carga === x.key ? 'on' : ''} onClick={() => setCarga(x.key)}>
                    {x.label}<small>{extraLabel(p[x.extra])}</small>
                  </button>
                ))}
              </div>
            )}
            {!esAlza && (
              <>
                <div className="grua-sub">Estado del vehículo · pregúntale al cliente</div>
                <div className="estado-lista">
                  {ESTADOS.map(e => (
                    <label key={e.key} className={`estado-item ${estado[e.key] ? 'on' : ''}`}>
                      <input type="checkbox" checked={!!estado[e.key]} onChange={ev => setEstado(s => ({ ...s, [e.key]: ev.target.checked }))} />
                      <span className="ei-txt"><strong>{e.label}</strong><small>{e.detalle}</small></span>
                      <span className="ei-val">+{fmtMoney(p[e.param])}</span>
                    </label>
                  ))}
                </div>
                {!ESTADOS.some(e => estado[e.key]) && <div className="f-hint">Sin marcar = el vehículo rueda, tiene llaves, está entero y con acceso libre.</div>}
              </>
            )}
            {esAlza && (
              <label className="grua-check" style={{marginTop:12}}>
                <input type="checkbox" checked={conRetiro} onChange={e => setConRetiro(e.target.checked)} />
                Incluir el retiro (2 viajes: llevarlo y volver a buscarlo)
              </label>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>2 · Recorrido</h2>
              <button className="btn-outline btn-sm" onClick={abrirRuta}>Ver ruta en Google Maps ↗</button>
            </div>
            <DireccionInput label="Base (salida y regreso de la grúa)" lugar={base} onChange={setBase} />
            <div className="quick-row" style={{gridTemplateColumns: esAlza ? '1fr' : '1fr 1fr', marginTop:10}}>
              {!esAlza && <DireccionInput label="Retiro (dónde está el vehículo)" lugar={origen} onChange={setOrigen} placeholder="Calle y número, comuna" />}
              <DireccionInput label={esAlza ? 'Obra (dónde se deja el alza hombres)' : 'Entrega (dónde se deja)'} lugar={destino} onChange={setDestino} placeholder="Calle y número, comuna" />
            </div>
            <div className="grua-tramos">
              {!esAlza && <Campo label="Base → retiro (vacío)" value={kmIda} onChange={kmManual(setKmIda)} suffix="km" />}
              <Campo label={esAlza ? 'Base → obra (con carga)' : 'Retiro → entrega (con carga)'} value={kmCarga} onChange={kmManual(setKmCarga)} suffix="km" />
              <Campo label={esAlza ? 'Obra → base (vacío)' : 'Entrega → base (vacío)'} value={kmVuelta} onChange={kmManual(setKmVuelta)} suffix="km" />
            </div>
            <div className={`f-hint ${rutaEstado === 'error' ? 'warn' : ''}`}>
              {rutaEstado === 'calculando' && 'Calculando la ruta…'}
              {rutaEstado === 'ok' && <>✓ Km calculados automáticamente por ruta en auto. Total por viaje: <strong>{c.kmTotal.toFixed(1)} km</strong>.</>}
              {rutaEstado === 'manual' && <>Km editados a mano. Total por viaje: <strong>{c.kmTotal.toFixed(1)} km</strong>.</>}
              {rutaEstado === 'error' && 'No se pudo calcular la ruta automáticamente (el servicio de mapas no respondió). Escribe los km a mano.'}
              {rutaEstado === '' && 'Elige las direcciones de la lista y los km se calculan solos (también puedes escribirlos a mano).'}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>3 · Condiciones del servicio</h2></div>
            <div className="f-group"><label>Horario</label>
              <div className="seg seg-sm">
                {HORARIOS.map(h => (
                  <button key={h.key} className={horario === h.key ? 'on' : ''} onClick={() => setHorario(h.key)}>{h.label}</button>
                ))}
              </div>
            </div>
            <div style={{display:'flex', flexDirection:'column', gap:8, margin:'12px 0'}}>
              <label className="grua-check"><input type="checkbox" checked={emergencia} onChange={e => setEmergencia(e.target.checked)} /> Emergencia (salida inmediata) · +{p.recargoEmergencia}%</label>
            </div>
            <div className="grua-tramos">
              <Campo label="Espera estimada en sitio" value={esperaMin} onChange={setEsperaMin} suffix="min" hint={`${p.esperaLibreMin} min incluidos`} />
              <Campo label="Peajes / TAG por viaje" value={peajes} onChange={setPeajes} money />
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Tarifas y costos de la grúa</h2>
              <button className="btn-outline btn-sm" onClick={() => setVerTarifas(v => !v)}>{verTarifas ? 'Ocultar' : 'Ajustar'}</button>
            </div>
            {!verTarifas && <div className="f-hint" style={{marginTop:-6}}>Petróleo {fmtMoney(p.diesel)}/L · {p.rendimiento} km/L · conductor {fmtMoney(p.conductorHora)}/h · mínimo {fmtMoney(p.minimo)}</div>}
            {verTarifas && (
              <>
                <div className="grua-sub">Costos de la grúa (no salen en la cotización)</div>
                <div className="param-grid">
                  <Campo label="Rendimiento grúa" value={p.rendimiento} onChange={v => setParam('rendimiento', v)} suffix="km/L" />
                  <Campo label="Precio petróleo" value={p.diesel} onChange={v => setParam('diesel', v)} money suffix="/L" />
                  <Campo label="Conductor por hora" value={p.conductorHora} onChange={v => setParam('conductorHora', v)} money />
                  <Campo label="Velocidad promedio" value={p.velocidad} onChange={v => setParam('velocidad', v)} suffix="km/h" />
                  <Campo label="Carga y descarga" value={p.horasManiobra} onChange={v => setParam('horasManiobra', v)} suffix="h/viaje" />
                  <Campo label="Desgaste y mantención" value={p.desgasteKm} onChange={v => setParam('desgasteKm', v)} money suffix="/km" />
                  <Campo label="Gastos fijos por viaje" value={p.gastoFijoViaje} onChange={v => setParam('gastoFijoViaje', v)} money hint="Seguro, permiso, cuota de la grúa… al mes ÷ viajes al mes" />
                </div>

                <div className="grua-sub">Recargo según lo que se traslada</div>
                <div className="f-hint" style={{marginTop:-4, marginBottom:8}}>Cuánto más se cobra por vehículos más grandes o pesados. Ejemplo: 15 = se cobra un 15% más que un auto.</div>
                <div className="param-grid">
                  {CARGAS.map(x => <Campo key={x.key} label={x.label} value={p[x.extra]} onChange={v => setParam(x.extra, v)} prefix="+" suffix="%" />)}
                </div>

                <div className="grua-sub">Maniobras según el estado del vehículo</div>
                <div className="param-grid">
                  <Campo label="No rueda" value={p.recNoRueda} onChange={v => setParam('recNoRueda', v)} money />
                  <Campo label="Sin llaves / sin neutro" value={p.recSinLlaves} onChange={v => setParam('recSinLlaves', v)} money />
                  <Campo label="Chocado o volcado" value={p.recSiniestro} onChange={v => setParam('recSiniestro', v)} money />
                  <Campo label="Acceso difícil" value={p.recAcceso} onChange={v => setParam('recAcceso', v)} money />
                </div>

                <div className="grua-sub">Recargos y cobros adicionales</div>
                <div className="param-grid">
                  <Campo label="Valor mínimo por servicio" value={p.minimo} onChange={v => setParam('minimo', v)} money />
                  <Campo label="Espera por hora" value={p.esperaHora} onChange={v => setParam('esperaHora', v)} money />
                  <Campo label="Espera incluida" value={p.esperaLibreMin} onChange={v => setParam('esperaLibreMin', v)} suffix="min" />
                  <Campo label="Noche / fin de semana" value={p.recargoNocturno} onChange={v => setParam('recargoNocturno', v)} prefix="+" suffix="%" />
                  <Campo label="Festivo" value={p.recargoFestivo} onChange={v => setParam('recargoFestivo', v)} prefix="+" suffix="%" />
                  <Campo label="Emergencia" value={p.recargoEmergencia} onChange={v => setParam('recargoEmergencia', v)} prefix="+" suffix="%" />
                </div>

                <div className="grua-sub">Tarifa por km (solo si usas ese método)</div>
                <div className="param-grid">
                  <Campo label="Cargo de salida" value={p.salida} onChange={v => setParam('salida', v)} money />
                  <Campo label="Por km con carga" value={p.kmCargado} onChange={v => setParam('kmCargado', v)} money />
                  <Campo label="Por km vacío" value={p.kmVacio} onChange={v => setParam('kmVacio', v)} money />
                </div>
                <div style={{marginTop:12}}>
                  <button className="btn-outline btn-sm" onClick={() => { setP({ ...PARAMS_DEFAULT, baseLugar: base }); toast('Valores restablecidos') }}>Volver a los valores de partida</button>
                </div>
              </>
            )}
          </div>

          <div className="card">
            <div className="card-head"><h2>4 · Cotización</h2></div>
            <div className="quick-row" style={{gridTemplateColumns:'0.6fr 1.4fr 1fr'}}>
              <div className="f-group"><label>N° de cotización</label><input type="text" inputMode="numeric" value={numeroEf} onChange={e => setNumero(e.target.value.replace(/[^\d]/g, ''))} /></div>
              <div className="f-group"><label>Cliente</label>
                <input type="text" list="dl-clientes-grua" value={cliente} onChange={e => onChangeCliente(e.target.value)} placeholder="Nombre o empresa (sale en el PDF)" autoComplete="off" />
                <datalist id="dl-clientes-grua">
                  {[...new Set(clientes.flatMap(x => [x.empresa, x.nombre].filter(Boolean)))].map(v => <option key={v} value={v} />)}
                </datalist>
              </div>
              <div className="f-group"><label>Fecha</label><input type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></div>
            </div>
            <div className="quick-row" style={{gridTemplateColumns:'1fr 1fr 1fr', marginTop:10}}>
              <div className="f-group"><label>RUT</label><input type="text" value={clienteRut} onChange={e => setClienteRut(formatRut(e.target.value))} /></div>
              <div className="f-group"><label>Dirección</label><input type="text" value={clienteDireccion} onChange={e => setClienteDireccion(e.target.value)} /></div>
              <div className="f-group"><label>Correo</label><input type="text" value={clienteCorreo} onChange={e => setClienteCorreo(e.target.value)} /></div>
            </div>

            <div className="grua-items-head">
              <div className="grua-sub" style={{margin:0}}>Ítems de la cotización</div>
              {editado && <button className="btn-outline btn-sm" onClick={volverAlCalculo}>Volver al cálculo automático</button>}
            </div>
            {!editado && <div className="f-hint" style={{marginTop:-2, marginBottom:8}}>Se arman solos con el calculador. Puedes editarlos, borrarlos o agregar otros.</div>}
            {calculoCambio && (
              <div className="grua-aviso">
                Cambiaste datos del cálculo después de editar los ítems. El cálculo nuevo da {fmtMoney(itemsAuto.reduce((s, it) => s + it.cantidad * it.valorUnit, 0))}.
                <button className="btn-orange btn-sm" onClick={volverAlCalculo}>Usar el cálculo nuevo</button>
              </div>
            )}
            <div className="grua-items">
              {items.map((it, i) => (
                <div key={i} className="grua-item-edit">
                  <textarea className="grua-textarea gie-desc" rows={3} value={it.descripcion} placeholder="Descripción del ítem" onChange={e => editarItem(i, 'descripcion', e.target.value)} />
                  <div className="gie-row">
                    <div className="f-group"><label>Unidad</label>
                      <select value={it.unidad} onChange={e => editarItem(i, 'unidad', e.target.value)}>
                        {['Servicio', 'un', 'Hora', 'Día'].map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <div className="f-group"><label>Cantidad</label>
                      <input type="text" inputMode="numeric" value={it.cantidad} onChange={e => editarItem(i, 'cantidad', e.target.value.replace(/[^\d]/g, ''))} />
                    </div>
                    <div className="f-group"><label>Valor unitario</label>
                      <div className="grua-input"><span className="pre">$</span>
                        <input type="text" inputMode="numeric" value={fmtInputMoney(it.valorUnit)} onChange={e => editarItem(i, 'valorUnit', parseMoneyInput(e.target.value))} />
                      </div>
                    </div>
                    <div className="gie-total"><label>Total</label><span className="mono">{fmtMoney((Number(it.cantidad) || 0) * (Number(it.valorUnit) || 0))}</span></div>
                    <button className="btn-danger btn-sm gie-del" onClick={() => borrarItem(i)} title="Borrar ítem">×</button>
                  </div>
                </div>
              ))}
              {!items.length && <div className="dir-vacio">Sin ítems.</div>}
            </div>
            <button className="btn-outline btn-sm" style={{marginTop:8}} onClick={agregarItem}>+ Agregar ítem</button>

            <div className="f-group" style={{marginTop:14}}><label>Condiciones comerciales (las líneas que terminan en ":" salen como título)</label>
              <textarea className="grua-textarea" rows={9} value={condiciones} onChange={e => setCondiciones(e.target.value)} />
            </div>
          </div>
        </div>

        <aside className="grua-side">
          <div className="card grua-total-card">
            <div className="seg seg-sm seg-modo">
              <button className={p.modo === 'utilidad' ? 'on' : ''} onClick={() => setParam('modo', 'utilidad')}>Costo + utilidad</button>
              <button className={p.modo === 'tarifa' ? 'on' : ''} onClick={() => setParam('modo', 'tarifa')}>Tarifa por km</button>
            </div>

            {p.modo === 'utilidad' && (
              <div className="grua-utilidad">
                <div className="gu-head">
                  <label>Utilidad sobre el costo</label>
                  <div className="grua-input gu-input">
                    <input type="text" inputMode="numeric" value={p.utilidad} onChange={e => setParam('utilidad', e.target.value.replace(/[^\d]/g, ''))} />
                    <span className="suf">%</span>
                  </div>
                </div>
                <input type="range" min="0" max="150" step="5" value={num(p.utilidad)} onChange={e => setParam('utilidad', e.target.value)} />
                <div className="f-hint" style={{marginTop:2}}>Con {num(p.utilidad)}%: si el viaje te cuesta $100, cobras ${100 + num(p.utilidad)}.</div>
              </div>
            )}

            <div className="gt-lbl" style={{marginTop:14}}>Precio al cliente</div>
            <div className="gt-val">{fmtMoney(netoCot)}<span> + IVA</span></div>
            <div className="gt-sub">Total con IVA {fmtMoney(netoCot * 1.19)}{c.viajes === 2 ? ' · 2 viajes' : ''}</div>
            {editado && <div className="gt-warn">Ítems editados a mano (el cálculo daba {fmtMoney(c.neto)})</div>}
            {faltanKm && <div className="gt-warn">Faltan los km de algún tramo</div>}

            <div className={`grua-ganancia ${margenClase}`}>
              <div><div className="gg-lbl">Ganas</div><div className="gg-val">{fmtMoney(ganancia)}</div></div>
              <div className="gg-pct">{Math.round(margenPct)}% del precio<br/>{Math.round(sobreCostoPct)}% sobre el costo</div>
            </div>

            <div className="grua-desglose">
              {p.modo === 'tarifa' ? (
                <>
                  <div className="gd-row"><span>Salida</span><span>{fmtMoney(p.salida)}</span></div>
                  <div className="gd-row"><span>{c.k2.toFixed(1)} km con carga × {fmtMoney(p.kmCargado)}</span><span>{fmtMoney(c.k2 * num(p.kmCargado))}</span></div>
                  <div className="gd-row"><span>{c.kmVacio.toFixed(1)} km vacío × {fmtMoney(p.kmVacio)}</span><span>{fmtMoney(c.kmVacio * num(p.kmVacio))}</span></div>
                </>
              ) : (
                <>
                  <div className="gd-row"><span>Costo de operar el viaje</span><span>{fmtMoney(c.costoOperacion)}</span></div>
                  <div className="gd-row"><span>+ Tu utilidad ({num(p.utilidad)}%)</span><span>{fmtMoney(c.b - c.costoOperacion)}</span></div>
                </>
              )}
              {c.extraCargaPct > 0 && <div className="gd-row"><span>+ {CARGAS.find(x => x.key === cargaEf).label} (+{c.extraCargaPct}%)</span><span>{fmtMoney(c.conCarga - c.b)}</span></div>}
              {c.recargoPct > 0 && <div className="gd-row"><span>+ Recargos horario/emergencia (+{c.recargoPct}%)</span><span>{fmtMoney(c.conRecargos - c.conCarga)}</span></div>}
              {c.aplicaMinimo && <div className="gd-row gd-note"><span>Suma {fmtMoney(c.conRecargos)}: es menos que el mínimo, se cobra el mínimo</span><span>{fmtMoney(p.minimo)}</span></div>}
              <div className="gd-row gd-strong"><span>Servicio (redondeado)</span><span>{fmtMoney(c.servicio)}</span></div>
              {c.maniobras.map(m => <div key={m.key} className="gd-row"><span>+ Maniobra: {m.pdf}</span><span>{fmtMoney(m.valor)}</span></div>)}
              {c.espera > 0 && <div className="gd-row"><span>+ Espera ({c.esperaExtraMin} min extra)</span><span>{fmtMoney(c.espera)}</span></div>}
              {c.vPeajes > 0 && <div className="gd-row"><span>+ Peajes (incluidos en el servicio, sin ganancia)</span><span>{fmtMoney(c.vPeajes)}</span></div>}
              {c.viajes === 2 && <div className="gd-row gd-strong"><span>× 2 viajes</span><span>{fmtMoney(c.neto)}</span></div>}
            </div>
            {!faltanKm && <div className="f-hint">Con {p.modo === 'tarifa' ? 'costo + utilidad' : 'tarifa por km'} el servicio saldría {fmtMoney(c.otroServicio)}.</div>}
          </div>

          <div className="card">
            <div className="card-head" style={{marginBottom:8}}><h2>Costo estimado {c.viajes === 2 ? 'por viaje' : 'del viaje'}</h2></div>
            <div className="grua-desglose" style={{marginTop:0}}>
              <div className="gd-row"><span>Petróleo ({(c.kmTotal / (num(p.rendimiento) || 1)).toFixed(1)} L)</span><span>{fmtMoney(c.combustible)}</span></div>
              <div className="gd-row"><span>Conductor manejando y cargando ({c.horasViaje.toFixed(1)} h)</span><span>{fmtMoney(c.horasViaje * num(p.conductorHora))}</span></div>
              <div className="gd-row"><span>Desgaste y mantención</span><span>{fmtMoney(c.desgaste)}</span></div>
              {c.fijo > 0 && <div className="gd-row"><span>Gastos fijos</span><span>{fmtMoney(c.fijo)}</span></div>}
              <div className="gd-row gd-strong"><span>Costo de operar el viaje</span><span>{fmtMoney(c.costoOperacion)}</span></div>
              {c.conductorEspera > 0 && <div className="gd-row"><span>+ Conductor esperando ({num(esperaMin)} min)</span><span>{fmtMoney(c.conductorEspera)}</span></div>}
              {c.vPeajes > 0 && <div className="gd-row"><span>+ Peajes</span><span>{fmtMoney(c.vPeajes)}</span></div>}
              {(c.conductorEspera > 0 || c.vPeajes > 0) && <div className="gd-row gd-strong"><span>Costo total {c.viajes === 2 ? 'por viaje' : ''}</span><span>{fmtMoney(c.costoViaje)}</span></div>}
              {c.viajes === 2 && <div className="gd-row gd-strong"><span>× 2 viajes</span><span>{fmtMoney(c.costo)}</span></div>}
            </div>
            <div className="f-hint">"Costo de operar" es lo que se usa para calcular tu utilidad. Los peajes y la espera se cobran aparte, por eso se suman después.</div>
            {!c.fijo && <div className="f-hint">Aún no incluye gastos fijos (seguro, permiso, cuota de la grúa). Agrégalos en "Tarifas y costos" para que la ganancia sea real.</div>}
          </div>

          <button className="btn-orange grua-pdf-btn" disabled={generando} onClick={descargarPdf}>
            {generando ? 'Generando…' : 'Descargar PDF de la cotización'}
          </button>
        </aside>
      </div>

      {/* Solo en pantallas angostas: el precio queda siempre a la vista mientras se llenan los datos */}
      <div className="grua-mobile-bar">
        <div>
          <div className="gm-lbl">Precio al cliente{c.viajes === 2 ? ' · 2 viajes' : ''}</div>
          <div className="gm-val">{fmtMoney(netoCot)} <span>+ IVA</span></div>
        </div>
        <div className={`gm-margen ${margenClase}`}>Ganas {fmtMoney(ganancia)}</div>
      </div>
    </>
  )
}
