-- ============================================================
-- ILUMSA · Gestión de Flota — Esquema de base de datos (Supabase)
-- ============================================================
-- Cómo usar: Supabase > tu proyecto > SQL Editor > pega este archivo > Run
-- Crea las tablas, activa seguridad por fila (RLS) y deja las
-- políticas de acceso: la Administradora edita todo, los
-- Vendedores pueden leer todo y crear reservas/cotizaciones,
-- pero no editar camiones ni tarifas.

-- 1) Perfiles de usuario (vinculados a auth.users de Supabase Auth)
create table if not exists perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  rol text not null check (rol in ('Administradora','Vendedor')),
  creado_en timestamptz default now()
);

-- 2) Camiones
create table if not exists camiones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  patente text not null,
  tamano int not null check (tamano in (13,20,28)),
  aislado text not null default 'No',
  estado_general text not null default 'Operativo' check (estado_general in ('Operativo','Mantención','Fuera de Servicio')),
  hasta date,
  creado_en timestamptz default now()
);

-- 3) Tarifas: arriendo base por tamaño
create table if not exists tarifas_arriendo (
  tamano int primary key check (tamano in (13,20,28)),
  valor numeric not null
);

-- 4) Tarifas: traslado por comuna y tamaño
create table if not exists tarifas_comunas (
  id uuid primary key default gen_random_uuid(),
  comuna text not null unique,
  p13 numeric not null default 0,
  p20 numeric not null default 0,
  p28 numeric not null default 0
);

-- 5) Reservas
create table if not exists reservas (
  id uuid primary key default gen_random_uuid(),
  camion_id uuid references camiones(id) on delete set null,
  cliente text not null,
  fecha date not null,
  comuna text not null,
  direccion text not null,
  estado text not null default 'Reservado' check (estado in ('Reservado','En Trabajo')),
  valor numeric not null default 0,
  creado_por uuid references perfiles(id),
  creado_en timestamptz default now()
);

-- 6) Cotizaciones
create table if not exists cotizaciones (
  id uuid primary key default gen_random_uuid(),
  cliente text not null default 'Sin nombre',
  tamano int not null,
  fecha date not null,
  comuna text not null,
  camion_id uuid references camiones(id) on delete set null,
  total numeric not null default 0,
  estado text not null default 'Pendiente' check (estado in ('Pendiente','Confirmada')),
  creado_por uuid references perfiles(id),
  creado_en timestamptz default now()
);

-- ============================================================
-- Seguridad por fila (RLS)
-- ============================================================
alter table perfiles enable row level security;
alter table camiones enable row level security;
alter table tarifas_arriendo enable row level security;
alter table tarifas_comunas enable row level security;
alter table reservas enable row level security;
alter table cotizaciones enable row level security;

-- Cualquier usuario autenticado del equipo puede LEER todo
create policy "leer perfiles" on perfiles for select to authenticated using (true);
create policy "leer camiones" on camiones for select to authenticated using (true);
create policy "leer tarifas_arriendo" on tarifas_arriendo for select to authenticated using (true);
create policy "leer tarifas_comunas" on tarifas_comunas for select to authenticated using (true);
create policy "leer reservas" on reservas for select to authenticated using (true);
create policy "leer cotizaciones" on cotizaciones for select to authenticated using (true);

-- Función auxiliar: ¿el usuario actual es Administradora?
create or replace function es_admin() returns boolean as $$
  select exists(select 1 from perfiles where id = auth.uid() and rol = 'Administradora');
$$ language sql security definer;

-- Solo Administradora puede crear/editar/borrar camiones y tarifas
create policy "admin escribe camiones" on camiones for all to authenticated using (es_admin()) with check (es_admin());
create policy "admin escribe tarifas_arriendo" on tarifas_arriendo for all to authenticated using (es_admin()) with check (es_admin());
create policy "admin escribe tarifas_comunas" on tarifas_comunas for all to authenticated using (es_admin()) with check (es_admin());

-- Cualquier usuario autenticado (vendedor o admin) puede crear reservas y cotizaciones
create policy "crear reservas" on reservas for insert to authenticated with check (true);
create policy "editar reservas" on reservas for update to authenticated using (true);
create policy "crear cotizaciones" on cotizaciones for insert to authenticated with check (true);
create policy "editar cotizaciones" on cotizaciones for update to authenticated using (true);

-- ============================================================
-- Datos iniciales (opcional, puedes borrar antes de correr si prefieres partir vacío)
-- ============================================================
insert into tarifas_arriendo (tamano, valor) values
  (13, 180000), (20, 280000), (28, 380000)
on conflict (tamano) do nothing;

insert into tarifas_comunas (comuna, p13, p20, p28) values
  ('Puente Alto', 40000, 55000, 70000),
  ('Maipú', 45000, 60000, 75000),
  ('Las Condes', 35000, 50000, 65000),
  ('Providencia', 30000, 45000, 60000),
  ('Santiago Centro', 25000, 40000, 55000),
  ('La Florida', 42000, 57000, 72000),
  ('Renca', 38000, 52000, 67000),
  ('Rancagua', 120000, 150000, 180000)
on conflict (comuna) do nothing;

insert into camiones (nombre, patente, tamano, aislado, estado_general) values
  ('Camión 13m – N°1', 'JH-RT-25', 13, 'No', 'Operativo'),
  ('Camión 13m – N°2', 'KJ-DF-68', 13, 'No', 'Operativo'),
  ('Camión 20m – N°1', 'LJ-TY-91', 20, 'Sí', 'Operativo'),
  ('Camión 20m – N°2', 'PK-BR-37', 20, 'Sí', 'Operativo'),
  ('Camión 28m – N°1', 'FL-GW-22', 28, 'Sí', 'Operativo'),
  ('Camión 13m – N°3', 'RW-VB-12', 13, 'No', 'Operativo')
on conflict do nothing;

-- ============================================================
-- IMPORTANTE — Crear a las 3 personas del equipo:
-- ============================================================
-- 1. Ve a Authentication > Users > Add user (en el panel de Supabase)
--    y crea las 3 cuentas con su correo y una contraseña.
-- 2. Copia el "User UID" que te muestra cada una.
-- 3. Por cada persona, corre (reemplazando los valores):
--
--    insert into perfiles (id, nombre, rol) values
--      ('PEGA-AQUI-EL-UID', 'Nombre de la persona', 'Administradora');
--
--    (usa 'Vendedor' para los otros dos)
