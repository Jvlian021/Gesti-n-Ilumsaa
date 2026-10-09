# CLAUDE.md — Ilumsa (gestión de flota + LicitApp)

Contexto de traspaso desde el Project "ILUMSA.GES" de claude.ai (octubre 2026).
Coloca este archivo en la raíz del repo. Claude Code lo lee solo al iniciar.

---

## 1. Quién trabaja y cómo

- Dueño/desarrollador: **Julián** (Kaju). Responder siempre en **español** (Chile).
- **3 usuarios** usan la app en el día a día (incluida la administradora). Julián le pasa las
  funciones nuevas a ella, así que **todo cambio se verifica antes de darlo por terminado**
  (ya pasó que un botón nuevo no guardaba y lo encontró ella en uso real).
- Forma de trabajo que Julián pide:
  - **Primero plantear bien la idea, después construir.** Ante pedidos grandes o ambiguos
    ("todo automatizado", "la herramienta final"), hacer preguntas de aclaración antes de
    escribir código. Varias veces el problema real resultó ser otro distinto al pedido.
  - Avance incremental, paso a paso, archivo por archivo.
  - **Avisar siempre si un cambio acerca a los límites del plan gratuito** de Vercel o
    Supabase (almacenamiento 1 GB, ancho de banda, pausas por inactividad, tiempo de
    ejecución de Edge Functions ~150 s, cantidad de proyectos).
  - **Nada de soluciones que dependan de un paso manual fuera de la app.** Tiene que
    funcionar igual y automático para los 3 usuarios.
  - **La app debe avisar rápido si algo no se va a poder hacer**, usando el chequeo más
    barato posible (contar páginas, tamaño de archivo) antes del trabajo caro (OCR, IA).
  - Casi todos los bugs reales salieron de capturas de uso real: pedirle que pruebe antes
    de cerrar una tarea.

## 2. Infraestructura

| Pieza | Valor |
|---|---|
| Repo GitHub | `Jvlian021/Gesti-n-Ilumsaa` |
| App de flota (Ilumsages) | https://gesti-n-ilumsaa.vercel.app |
| LicitApp (licitaciones) | https://licitapp2.vercel.app |
| Supabase LicitApp | proyecto `LICITAPP`, ref `sxajzengzqvfiemiprwk` |
| Supabase flota | proyecto `Gestión Ilumsa` (ref: confirmar con `list_projects`) |
| Deploy frontend | push a GitHub → Vercel compila solo |
| Stack | React + Vite (`App.jsx` monolítico), Supabase (Postgres + RLS + Storage + Edge Functions Deno), Anthropic API desde Edge Functions |

> ✅ Confirmado (2026-10-09): este repo (`Jvlian021/Gesti-n-Ilumsaa`) contiene **solo la app de
> flota** (`ilumsa-flota`: React + Vite, `src/App.jsx` ~2.300 líneas, jsPDF). LicitApp vive en
> otro repo. Esquema de BD en `supabase/schema.sql` (perfiles, camiones, tarifas_arriendo,
> tarifas_comunas, conductores, reservas, cotizaciones). Variables: `VITE_SUPABASE_URL`,
> `VITE_SUPABASE_ANON_KEY` en `.env` (ver `.env.example`, nunca commitear `.env`).

> La org de Supabase de Julián ya tiene 2 proyectos free (el máximo). Kaju
> (Comercializadora Leyton Canales SpA) tiene su **copia independiente** en otra org
> ("KAJU SpA", ref `ifhwtottmiiuwqsxggbl`). No mezclar datos ni deploys entre ambas.

### Conector Supabase (MCP)
Por defecto usarlo **solo lectura** (consultas, inspección, logs). Escrituras, migraciones
y deploys de funciones **solo con permiso explícito de Julián para ese caso puntual**.

## 3. Reglas técnicas que ya costaron caro

1. **Nada de `window.alert` / `window.confirm`.** Todo diálogo pasa por `gestorDialogo`
   (`avisar`, `confirmar`, `elegir`) + `<DialogoGlobal />`. Funciona también desde funciones
   async que no son componentes.
2. **Trampa TDZ** (tumbó la app dos veces, pantalla en blanco): un `const` de nivel módulo
   que referencia otro identificador declarado más abajo revienta al cargar
   (`Cannot access 'X' before initialization`). `tsc` NO lo detecta. Solución: convertirlo en
   `function` o reordenar. Revisar el orden de declaración al mover/agregar constantes.
3. **`package.json`**: nunca reescribirlo desde una copia vieja (una vez se perdió
   `tesseract.js` y se rompió el build). Agregar dependencias con `npm install <pkg>` y
   revisar el diff.
4. **Nombres de Edge Functions exactos**: el nombre en Supabase debe calzar con el `fetch`
   de la app. Una función creada con otro nombre falla en silencio.
5. **Normalizar texto externo**: Mercado Público manda "O´Higgins" (U+00B4) y la gente
   escribe "O'Higgins" (U+0027). `normalizar()` quita tildes **y** apóstrofos/acentos
   sueltos. Mantenerlo así en cualquier comparación nueva.
6. **Edge Functions y tiempo**: tope real ~150 s (plan free). No apilar reintentos dentro de
   una misma invocación (comparten el presupuesto de tiempo): reintentar desde el navegador.
   No subir `max_tokens` de `ilumia-factibilidad` sobre 14.000 (provocó WORKER_RESOURCE_LIMIT).
   Ante timeouts: **pedir/leer el log de Supabase antes de tocar código**.
7. **Un 502 con "código 400" de la API de Claude** puede ser saldo agotado en
   console.anthropic.com → revisar billing antes de depurar.
8. **Pestañas ocultas**: trabajos largos (informe de factibilidad, detectar exigencias) corren
   en el navegador; están protegidos con Web Locks (`sinCongelarPestanaMientras`).
9. **Itemizado oficial**: si la licitación trae itemizado oficial, nada se modifica y la IA
   no propone itemizado. Transcribir sí; modificar no.
10. **Formularios Word**: se rellena el ORIGINAL (solo `word/document.xml`), nunca se rehace.
    Regex de corridas: `<w:t(?:\s[^>]*)?>` (la otra matchea `<w:tab/>`). Rellenar con
    espacios, no guiones; agregar `xml:space="preserve"`. Lo hecho por IA queda marcado
    "IA · revisar" y nunca como `listo`.
11. **Nunca pisar datos escritos a mano** (precios, materiales, cantidades): la IA agrega,
    no reemplaza.
12. Convención de funciones `ilumia-*`: fetch crudo a `https://api.anthropic.com/v1/messages`,
    schema de herramienta como objeto plano, `tool_choice` forzado, registrar costo en
    `uso_ia`. Secreto `ANTHROPIC_API_KEY` (sin secrets nuevos salvo que se pida).

## 4. Verificación antes de entregar

En Claude Code sí se puede compilar localmente (en el chat no se podía):
```bash
npm install
npm run build        # debe compilar sin errores
npm run dev          # probar el flujo tocado en el navegador
```
Para Edge Functions: `deno check supabase/functions/<nombre>/index.ts` si está Deno, o al
menos revisar sintaxis. Después del deploy, pedirle a Julián que confirme en la app real
(y que confirme que Vercel efectivamente publicó el último commit).

## 5. Mapa de LicitApp (resumen)

- **Barrido Mercado Público** (`mp-sweep`, cron cada 15 min: licitaciones `0,15,30,45`,
  compra ágil `5,20,35,50`). Compra Ágil: `tamano_pagina=10` (50 siempre da 504), filtro de
  fechas obligatorio, listado de más nuevo a más antiguo, cursor `mp_ca_cursor.ultima_fecha_vista`.
  Modos de diagnóstico: `?solo=sonda`, `?solo=ficha&codigo=XXXX`. Log en `barridos_log`.
- **Seguimiento** (`mp-seguimiento`, cada 2 h): avisa cambios en oportunidades seguidas;
  correo con prefijo "Seguimiento · " y acento naranjo `#b7791f`.
- **Compatibilidad** (`ilumia-analiza`, Haiku): una sola regla de región (`reglaDeRegion()`);
  búsquedas con región propia (ej. "Alzahombres", todo Chile) vía `busqueda_nombre`/`busqueda_regiones`.
- **Informe de Factibilidad** (`ilumia-factibilidad`): análisis por lotes
  (`LIMITE_CARACTERES_TOTAL` = 150.000, `MAX_LOTES` = 12), modo actualización por deltas
  (`fusionarInformeConAnterior`), salva campos corruptos/faltantes (`secciones_con_error`),
  "Agregar documentos y actualizar informe" con historial en `informes_factibilidad_historial`.
- **Preparar Oferta**: 5 pasos (Documentos, Exigencias, Itemizado, Revisión, Carpeta .zip),
  chat "Preguntar a ILUMIA" (`ilumia-chat-licitacion`, historial privado por usuario),
  formularios, `datos_empresa`, detección de itemizado (SheetJS / `ilumia-itemizado`),
  materiales (`ilumia-materiales`), precios (`ilumia-precios`).
- **Presupuestador interno** (`ilumia-presupuesto` + `PresupuestoInterno`, Excel con `exceljs`),
  catálogo `precios_referencia` (separado de `precios_historicos` por decisión de Julián).

## 6. Pendientes conocidos

**Flota / general**
- Cotizador en la sección "Cotizaciones": cotizaciones rápidas con el formato de Saavedra y
  Compañía Ltda / Ilumsa (encabezado cliente + N°, tabla descripción/unidad/cantidad/valor
  unitario/total, subtotal neto, descuento %, IVA 19 %, total, condiciones comerciales, datos
  bancarios). Es distinto del presupuestador interno. Pedir el PDF de referencia antes de diseñar.

**LicitApp (pendientes de confirmar en uso real)**
- Licitación grande 2775-116-LP26 y Compra Ágil 3887-43-LE26: que el informe salga completo
  sin timeouts. Si vuelve a fallar con un solo intento → evaluar `ilumia-factibilidad` como
  trabajo en segundo plano (responde al tiro, guarda en BD, la app consulta).
- Botones Seguir/En oferta/Descartar como toggle (entrega142) y descarga de PDF sin quedarse
  pegada (entrega139).
- Alzahombres fuera de RM/O'Higgins con compatibilidad alta/media; decidir si refrescar
  `660872-18-LP26` y `3730-218-COT26`.
- Presupuestador: cargar catálogo real en `precios_referencia`; confirmar deploy de `exceljs`.
- Rellenar itemizado oficial en Excel: **bloqueado** hasta tener un Excel real de unas bases.
- Parámetros: mostrar "última modificación por X el día Y".
- Portar "agregar documentos al informe" a la copia de Kaju.
- El eléctrico debe subir su planilla en "Precios de referencia".

## 7. Documentación detallada

El historial completo (entregas 66→145, causas raíz y decisiones) está en el Project de
claude.ai, en `claude/preparar-oferta.md`, `claude/barrido-mercado-publico.md`,
`claude/presupuestador-interno.md` y `claude/informe-factibilidad-agregar-documentos.md`.
Conviene copiarlos a `docs/` del repo para que Claude Code los consulte cuando haga falta.
