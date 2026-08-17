export function isoDate(d) { return d.toISOString().slice(0, 10) }
export function startOfWeek(d) { const x = new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate() - x.getDay()); return x }
// Lunes de la semana que contiene la fecha d (semana laboral lunes-viernes)
export function startOfWorkWeek(d) {
  const x = new Date(d); x.setHours(0,0,0,0)
  const day = x.getDay() // 0=Dom ... 6=Sáb
  const diffToMonday = day === 0 ? -6 : 1 - day
  x.setDate(x.getDate() + diffToMonday)
  return x
}
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
export function fmtMoney(n) { return '$' + Math.round(n || 0).toLocaleString('es-CL') }
// Para inputs editables: muestra "25.000" (sin $) y limpia lo que el usuario escriba a solo dígitos.
export function fmtInputMoney(n) { return Math.round(Number(n) || 0).toLocaleString('es-CL') }
export function parseMoneyInput(str) { return Number(String(str).replace(/[^\d]/g, '')) || 0 }
export const DIAS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
export const MESES = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC']

export function badgeClassFor(estado) {
  return {
    'Disponible': 'st-disponible', 'Reservado': 'st-reservado', 'En Trabajo': 'st-trabajo',
    'Mantención': 'st-mantencion', 'Fuera de Servicio': 'st-fuera',
  }[estado] || 'st-pendiente'
}

// Estado de un camión en una fecha dada, cruzando su estado general
// (mantención / fuera de servicio) con las reservas de ese día.
export function camionEstadoEnFecha(camion, dateIso, reservas) {
  if ((camion.estado_general === 'Mantención' || camion.estado_general === 'Fuera de Servicio')
      && (!camion.hasta || dateIso <= camion.hasta)) {
    return camion.estado_general
  }
  const res = reservas.find(r => r.camion_id === camion.id && r.fecha === dateIso)
  if (res) return res.estado
  return 'Disponible'
}

export function findAvailableTruck(camiones, reservas, size, dateIso) {
  return camiones.find(c => c.tamano === Number(size) && camionEstadoEnFecha(c, dateIso, reservas) === 'Disponible')
}

export function priceFor(tarifaArriendo, tarifasComunas, size, comunaName) {
  const arriendo = tarifaArriendo[size] || 0
  const com = tarifasComunas.find(c => c.comuna === comunaName)
  const traslado = com ? com['p' + size] : 0
  const subtotal = arriendo + traslado
  return { arriendo, traslado, subtotal, total: subtotal * 1.19 }
}
