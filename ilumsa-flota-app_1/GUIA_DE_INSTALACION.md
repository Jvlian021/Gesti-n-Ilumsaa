# Ilumsa · Gestión de Flota — Guía de instalación

Esta guía te deja el sitio funcionando en internet, con su propia
dirección web (URL) y login real con contraseña para las 3 personas
del equipo. No necesitas saber programar, solo seguir los pasos.
Tiempo estimado: 30–40 minutos, una sola vez.

Vas a usar dos servicios gratuitos (para este tamaño de uso):
- **Supabase**: la base de datos + el sistema de login.
- **Vercel**: donde vive el sitio web (el hosting).

---

## Paso 1 — Crear el proyecto en Supabase

1. Ve a [supabase.com](https://supabase.com) y crea una cuenta gratis.
2. Click en **New project**. Ponle un nombre (ej. `ilumsa-flota`) y una
   contraseña de base de datos (guárdala en un lugar seguro, no la
   necesitarás seguido).
3. Espera 1-2 minutos a que el proyecto termine de crearse.

## Paso 2 — Crear las tablas de datos

1. En el menú lateral de Supabase, entra a **SQL Editor**.
2. Abre el archivo `supabase/schema.sql` de esta carpeta, copia todo
   su contenido y pégalo en el editor.
3. Dale a **Run**. Esto crea las tablas (camiones, reservas, tarifas,
   cotizaciones) y las reglas de quién puede ver/editar qué.

## Paso 3 — Crear las 3 cuentas de acceso

1. En Supabase, ve a **Authentication → Users → Add user**.
2. Crea una cuenta por cada persona: correo + contraseña. Repite para
   las 3 (administradora + 2 vendedores).
3. Por cada usuario creado, copia su **User UID** (aparece en la lista).
4. Vuelve a **SQL Editor** y corre esto por cada persona, reemplazando
   los datos (usa `'Administradora'` solo para ella, `'Vendedor'` para
   los otros dos):

   ```sql
   insert into perfiles (id, nombre, rol) values
     ('PEGA-AQUI-EL-USER-UID', 'Nombre de la persona', 'Administradora');
   ```

## Paso 4 — Obtener las claves de conexión

1. En Supabase, ve a **Project Settings → API**.
2. Copia el **Project URL** y la clave **anon public**. Las vas a
   necesitar en el Paso 6.

## Paso 5 — Subir el código a GitHub

1. Crea una cuenta gratis en [github.com](https://github.com) si no
   tienes una.
2. Crea un repositorio nuevo (ej. `ilumsa-flota`), y sube todos los
   archivos de esta carpeta (`ilumsa-flota/`) a ese repositorio.
   - Si nunca has usado GitHub, la forma más simple es arrastrar los
     archivos directamente en la página web del repositorio nuevo
     ("uploading an existing file").

## Paso 6 — Publicar el sitio en Vercel

1. Ve a [vercel.com](https://vercel.com) y crea una cuenta gratis
   (puedes entrar directo con tu cuenta de GitHub).
2. Click en **Add New → Project**, y elige el repositorio que subiste.
3. Vercel detecta automáticamente que es un proyecto Vite/React — no
   cambies esa configuración.
4. Antes de darle a **Deploy**, abre la sección **Environment Variables**
   y agrega estas dos, con los valores que copiaste en el Paso 4:
   - `VITE_SUPABASE_URL` → tu Project URL
   - `VITE_SUPABASE_ANON_KEY` → tu clave anon public
5. Click en **Deploy**. En 1-2 minutos te da una URL pública, algo como
   `ilumsa-flota.vercel.app`.

## Paso 7 — Probarlo

1. Abre la URL que te dio Vercel.
2. Entra con el correo y contraseña de una de las 3 cuentas que creaste.
3. Deberías ver el dashboard con los datos iniciales (6 camiones,
   tarifas de ejemplo).

Guarda esa URL como acceso directo en el celular o marcador del
navegador de cada persona — ya no depende de abrir ningún chat.

---

## Después de instalado: cómo se usa el día a día

- **La administradora** entra y desde "Camiones" cambia el estado
  (Operativo / Mantención / Fuera de Servicio), y desde "Tarifas"
  actualiza los precios semanales.
- **Los vendedores** entran, ven el calendario y tarifas al día, y
  crean reservas o cotizaciones sin tener que preguntarle a nadie.
- Todo lo que un vendedor cotiza y confirma queda registrado con su
  nombre, para que quede trazabilidad de quién agendó qué.
- Los cambios se ven en vivo entre los 3: si la administradora marca
  un camión en mantención, el vendedor lo ve reflejado al instante sin
  recargar la página.

## Si algo falla

- **"Correo o contraseña incorrectos"**: revisa que el correo esté
  exactamente igual al que creaste en Supabase Authentication.
- **Se queda en "Preparando tu cuenta…"**: falta el paso de crear el
  perfil en la tabla `perfiles` (Paso 3) para ese usuario.
- **La app carga en blanco**: revisa que las dos variables de entorno
  en Vercel estén bien escritas (sin espacios, sin comillas).

## Costos

Con 3 usuarios y este volumen de datos, tanto Supabase como Vercel se
mantienen dentro de su plan gratuito indefinidamente. Si más adelante
crecen mucho (muchos más usuarios o mucho tráfico), ahí recién tendría
sentido evaluar un plan pago.
