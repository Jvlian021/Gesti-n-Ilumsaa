-- ============================================================
-- ILUMSA · Agregar todas las comunas de la Región Metropolitana
-- ============================================================
-- Cómo usar: Supabase > tu proyecto > SQL Editor > pega este archivo > Run
-- Es seguro correrlo aunque ya tengas algunas comunas cargadas:
-- las que ya existen (mismo nombre exacto) se omiten automáticamente
-- gracias a "on conflict (comuna) do nothing", no se duplican ni se
-- sobrescriben sus precios actuales.
--
-- Los valores de traslado quedan en 0 para las comunas nuevas —
-- entra a la app, sección Tarifas, y complétalos (o bórralas si no
-- las necesitas, ahora se puede desde la misma pantalla).

insert into tarifas_comunas (comuna, p13, p20, p28) values
  ('Santiago', 0, 0, 0),
  ('Cerrillos', 0, 0, 0),
  ('Cerro Navia', 0, 0, 0),
  ('Conchalí', 0, 0, 0),
  ('El Bosque', 0, 0, 0),
  ('Estación Central', 0, 0, 0),
  ('Huechuraba', 0, 0, 0),
  ('Independencia', 0, 0, 0),
  ('La Cisterna', 0, 0, 0),
  ('La Florida', 0, 0, 0),
  ('La Granja', 0, 0, 0),
  ('La Pintana', 0, 0, 0),
  ('La Reina', 0, 0, 0),
  ('Las Condes', 0, 0, 0),
  ('Lo Barnechea', 0, 0, 0),
  ('Lo Espejo', 0, 0, 0),
  ('Lo Prado', 0, 0, 0),
  ('Macul', 0, 0, 0),
  ('Maipú', 0, 0, 0),
  ('Ñuñoa', 0, 0, 0),
  ('Pedro Aguirre Cerda', 0, 0, 0),
  ('Peñalolén', 0, 0, 0),
  ('Providencia', 0, 0, 0),
  ('Pudahuel', 0, 0, 0),
  ('Quilicura', 0, 0, 0),
  ('Quinta Normal', 0, 0, 0),
  ('Recoleta', 0, 0, 0),
  ('Renca', 0, 0, 0),
  ('San Joaquín', 0, 0, 0),
  ('San Miguel', 0, 0, 0),
  ('San Ramón', 0, 0, 0),
  ('Vitacura', 0, 0, 0),
  ('Puente Alto', 0, 0, 0),
  ('Pirque', 0, 0, 0),
  ('San José de Maipo', 0, 0, 0),
  ('Colina', 0, 0, 0),
  ('Lampa', 0, 0, 0),
  ('Tiltil', 0, 0, 0),
  ('San Bernardo', 0, 0, 0),
  ('Buin', 0, 0, 0),
  ('Calera de Tango', 0, 0, 0),
  ('Paine', 0, 0, 0),
  ('Melipilla', 0, 0, 0),
  ('Alhué', 0, 0, 0),
  ('Curacaví', 0, 0, 0),
  ('María Pinto', 0, 0, 0),
  ('San Pedro', 0, 0, 0),
  ('Talagante', 0, 0, 0),
  ('El Monte', 0, 0, 0),
  ('Isla de Maipo', 0, 0, 0),
  ('Padre Hurtado', 0, 0, 0),
  ('Peñaflor', 0, 0, 0)
on conflict (comuna) do nothing;

-- Nota: ya tenías "Santiago Centro" cargada con precio, y esta lista
-- agrega además "Santiago" (nombre oficial de la comuna). Si quieres
-- evitar tener las dos, entra a Tarifas en la app y elimina la que
-- no vayas a usar (ahora hay un botón "Eliminar" por comuna).
