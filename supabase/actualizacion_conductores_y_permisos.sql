-- ============================================================
-- ILUMSA · Actualización: conductores, hora/descripción en reservas,
-- y arreglo del permiso para eliminar reservas
-- ============================================================
-- Cómo usar: Supabase > tu proyecto > SQL Editor > pega este archivo > Run
-- Es seguro correrlo una sola vez sobre tu base ya existente.

-- 1) Tabla de conductores (solo tienen 3, pero se puede agregar/quitar)
create table if not exists conductores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  telefono text,
  creado_en timestamptz default now()
);

alter table conductores enable row level security;

drop policy if exists "leer conductores" on conductores;
create policy "leer conductores" on conductores for select to authenticated using (true);

drop policy if exists "admin escribe conductores" on conductores;
create policy "admin escribe conductores" on conductores for all to authenticated using (es_admin()) with check (es_admin());

-- 3 conductores de ejemplo, cambia los nombres por los reales
-- (o edítalos después directo desde la app, en la sección Conductores)
insert into conductores (nombre) values
  ('Conductor 1'),
  ('Conductor 2'),
  ('Conductor 3');

-- 2) Campos nuevos en reservas: hora, descripción y conductor asignado
alter table reservas add column if not exists hora time;
alter table reservas add column if not exists descripcion text;
alter table reservas add column if not exists conductor_id uuid references conductores(id) on delete set null;

-- 3) Arreglo: faltaba el permiso para BORRAR reservas
-- (por eso el botón "Eliminar" no funcionaba — no era un error de la
-- app, era que la base de datos no tenía autorizado ese permiso)
drop policy if exists "eliminar reservas" on reservas;
create policy "eliminar reservas" on reservas for delete to authenticated using (true);
