-- ============================================================
-- Grúa cama baja: tarifas compartidas, cotizaciones y camión-grúa
-- Aplicado en Supabase (proyecto Gestión Ilumsa) el 2026-10-09.
-- Solo agrega columnas/tablas; no borra datos.
-- ============================================================

-- 1) Tipo de vehículo: la grúa no tiene tamaño de alza hombre
alter table public.camiones add column if not exists tipo text not null default 'Alza hombre';
alter table public.camiones add constraint camiones_tipo_check check (tipo in ('Alza hombre', 'Grúa'));
alter table public.camiones alter column tamano drop not null;
alter table public.camiones drop constraint camiones_tamano_check;
alter table public.camiones add constraint camiones_tamano_check
  check ((tipo = 'Grúa' and tamano is null) or (tipo = 'Alza hombre' and tamano in (13, 18, 20)));

-- 2) Cotizaciones: tipo (Arriendo / Grúa) + detalle del traslado
alter table public.cotizaciones add column if not exists tipo text not null default 'Arriendo';
alter table public.cotizaciones add constraint cotizaciones_tipo_check check (tipo in ('Arriendo', 'Grúa'));
alter table public.cotizaciones add column if not exists detalle jsonb;

-- 3) Permiso para editar las tarifas de grúa (además de la administradora)
alter table public.perfiles add column if not exists edita_tarifas_grua boolean not null default false;

create or replace function public.puede_tarifas_grua()
returns boolean language sql security definer set search_path = public as $$
  select exists(select 1 from perfiles where id = auth.uid() and (rol = 'Administradora' or edita_tarifas_grua));
$$;

-- 4) Tarifas de grúa compartidas (una sola fila; los valores iniciales están en src/Grua.jsx → PARAMS_DEFAULT)
create table if not exists public.tarifas_grua (
  id int primary key default 1 check (id = 1),
  params jsonb not null default '{}'::jsonb,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid references public.perfiles(id),
  actualizado_por_nombre text
);
alter table public.tarifas_grua enable row level security;
create policy "leer tarifas_grua" on public.tarifas_grua for select to authenticated using (true);
create policy "editar tarifas_grua" on public.tarifas_grua for update to authenticated
  using (public.puede_tarifas_grua()) with check (public.puede_tarifas_grua());

update public.perfiles set edita_tarifas_grua = true where nombre = 'Julián Leyton';

-- 5) El camión JJ-VB-53 pasó a ser grúa (se le instaló una cama baja)
update public.camiones set tipo = 'Grúa', tamano = null, nombre = 'Grúa cama baja – 53' where patente = 'JJ-VB-53';
