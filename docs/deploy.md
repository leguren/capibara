# docs/deploy.md — Guía de deploy

Stack: GitHub → Vercel (backend + frontend) + Turso (DB).

> **Estado actual:** el deploy real está en `https://capibara-ten.vercel.app`,
> sin dominio propio todavía. El Paso 5 (Cloudflare) es para el día que se
> configure un dominio propio (ej. `capibara.io`) — hasta entonces no aplica,
> y las reglas de caché de ese paso no están activas.

---

## Paso 1: Turso

1. Ir a turso.tech → crear cuenta → New Database → nombre: `capibara` → región más cercana (ej: `gru` para Brasil).
2. En el dashboard de la DB: copiar la URL (`libsql://capibara-xxx.turso.io`).
3. Pestaña Tokens → Create Token → copiar el token.
4. Guardar ambos — los vas a necesitar en Vercel.

El schema se crea automáticamente en el primer request. No hace falta correr nada manualmente.

---

## Paso 2: Google OAuth

1. Ir a console.cloud.google.com → seleccionar o crear un proyecto.
2. APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID.
3. Application type: Web application.
4. Authorized redirect URIs: `https://capibara-ten.vercel.app/api/auth/callback` (agregar la de un dominio propio acá también el día que se configure uno).
5. Copiar Client ID y Client Secret.

---

## Paso 3: GitHub

1. Crear repositorio en github.com → nombre: `capibara` → privado.
2. Subir el contenido del ZIP: arrastrar todos los archivos al repositorio desde la interfaz web de GitHub, o usar Upload files.
3. Verificar que la estructura quede así en la raíz: `api/`, `admin/`, `dashboard/`, `login/`, `publish/`, `src/`, `style/`, `vocab/`, `config/`, `docs/`, `vercel.json`, `package.json`.

---

## Paso 4: Vercel

1. Ir a vercel.com → Add New Project → importar el repositorio de GitHub.
2. Framework Preset: Other (no Next.js, no nada).
3. Build & Output Settings: dejar todo vacío — no hay build step.
4. Deploy → va a fallar la primera vez porque faltan las variables de entorno. Eso es esperado.
5. Ir a Settings → Environment Variables → agregar:

```
TURSO_URL              libsql://capibara-xxx.turso.io
TURSO_AUTH_TOKEN       (el token de Turso)
GOOGLE_CLIENT_ID       (el client ID de Google)
GOOGLE_CLIENT_SECRET   (el client secret de Google)
GOOGLE_REDIRECT_URI    https://capibara-ten.vercel.app/api/auth/callback
SESSION_SECRET         (string aleatorio largo — ver abajo cómo generarlo)
```

Para generar SESSION_SECRET: ir a generate-secret.vercel.app o usar cualquier generador de strings aleatorios de 48+ caracteres.

Opcionales (tienen default razonable si no se setean — ver `api/geo/query.js`):

```
SESSION_TTL_MS              duración de la sesión en ms. Default: 7 días.
RATE_LIMIT_KEY_PER_MIN      requests/min por API key sin límite propio. Default: 60.
RATE_LIMIT_DEMO_PER_MIN     requests/min por IP en /api/geo/1/query/demo. Default: 20.
RATE_LIMIT_PREVIEW_PER_MIN  requests/min por usuario en /api/geo/1/query/preview. Default: 120.
RATE_LIMIT_WINDOW_SECONDS   tamaño de la ventana deslizante del rate limit, en segundos. Default: 60.
```

6. Redeploy desde el dashboard de Vercel (Deployments → tres puntos → Redeploy).

---

## Paso 5: Cloudflare (opcional — solo si se configura un dominio propio)

> Este paso no está activo hoy (el deploy usa el dominio de Vercel directo,
> sin Cloudflare en el medio). Dejarlo documentado para cuando se compre y
> configure un dominio propio.

### 5a. Dominio y DNS

1. Ir a dash.cloudflare.com → Add a Site → ingresar el dominio (ej: `capibara.io`).
2. Elegir el plan Free → Cloudflare muestra los nameservers que hay que configurar.
3. Ir al registrador del dominio (GoDaddy, Namecheap, etc.) → cambiar los nameservers por los de Cloudflare.
4. Esperar propagación (puede tardar hasta 24hs, generalmente menos).

### 5b. Apuntar el dominio a Vercel

1. En Vercel: Settings → Domains → agregar `capibara.io` y `www.capibara.io`.
2. Vercel muestra un CNAME o IP que hay que configurar.
3. En Cloudflare: DNS → Add Record:
   - Type: `CNAME`
   - Name: `@` (o `capibara.io`)
   - Target: el valor que dio Vercel (generalmente `cname.vercel-dns.com`)
   - Proxy status: **Proxied** (nube naranja — esto es lo que activa el caché de Cloudflare)
4. Repetir para `www` si aplica.

### 5c. Caché de la API pública

El endpoint `/api/geo/1/query` ya manda headers `Cache-Control` con el TTL correcto según la capa más dinámica del resultado. Cloudflare los respeta automáticamente cuando el proxy está activo.

Para verificar que el caché funciona: hacer la misma request dos veces y revisar el header `CF-Cache-Status` en la respuesta. Valores posibles:
- `MISS` → primera vez, Cloudflare fue a buscar a Vercel
- `HIT` → Cloudflare sirvió desde caché sin tocar Vercel
- `EXPIRED` → había caché pero venció, fue a buscar de nuevo
- `BYPASS` → el endpoint mandó `Cache-Control: no-store` (capas con `update_frequency: continual`)

### 5d. Regla para no cachear el panel admin

El panel admin (`/admin`, `/dashboard`, `/publish`, `/api/admin/*`, `/api/auth/*`, `/api/user/*`) nunca debe cachearse — tiene datos de sesión.

En Cloudflare: Rules → Cache Rules → Create Rule:
- Nombre: `No cache — admin y auth`
- Condición: URI path starts with `/api/admin` OR starts with `/api/auth` OR starts with `/api/user` OR starts with `/admin` OR starts with `/dashboard` OR starts with `/publish`
- Acción: Cache Eligibility → Bypass cache
- Guardar y deployar.

Sin esta regla, Cloudflare podría cachear páginas del panel y servir la sesión de un usuario a otro.

### 5e. SSL

Cloudflare maneja SSL automáticamente en el plan free. Verificar que SSL/TLS → Overview esté en modo "Full" (no "Flexible").

---

## Paso 5f: Tabla nueva en una DB ya inicializada (rate limiting)

`initSchema()` (en `api/_db.js`) solo crea el schema completo la primera vez
que corre contra una DB vacía — si ya hiciste el deploy inicial y tu DB en
Turso ya tiene la tabla `users`, las tablas nuevas que se agreguen después
**no se crean solas**. La tabla `rate_limit_hits` (usada por el rate limiting
de `/api/geo/1/query` y `/demo`) se agregó después del primer deploy, así que
si tu DB ya estaba inicializada, correla a mano una sola vez:

1. dash.turso.tech → seleccionar la DB `capibara` → Shell.
2. Correr:
```sql
CREATE TABLE IF NOT EXISTS rate_limit_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket TEXT NOT NULL, requested_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_bucket ON rate_limit_hits(bucket, requested_at);
```
3. (Opcional, limpieza) Si ya habías llegado a usar `layer_dependencies` en algún momento, se puede borrar — ya no se usa:
```sql
DROP TABLE IF EXISTS layer_dependencies;
```

En un deploy nuevo contra una DB vacía esto no hace falta — `initSchema()`
va a crear todo, incluida `rate_limit_hits`, en el primer cold start.

---

## Paso 6: Primer admin

Después del primer login con Google, cambiar el role a admin desde el dashboard de Turso:

1. dash.turso.tech → seleccionar la DB `capibara` → Shell.
2. Correr:
```sql
UPDATE users SET role = 'admin' WHERE email = 'tu@email.com';
```
3. Cerrar sesión en la app y volver a entrar — el panel /admin va a estar accesible.

---

## Paso 7: Verificar que todo funciona

1. Ir a `https://capibara-ten.vercel.app/login` → ingresar con Google → redirigir a `/admin`.
2. Crear primera fuente → Conectar → Descubrir capas → activar alguna capa → Publicar.
3. Ir a `/dashboard` → crear una API key.
4. Probar el endpoint desde el browser o desde un cliente HTTP:

```
GET https://capibara-ten.vercel.app/api/geo/1/query?lat=-34.603&lon=-58.382
Authorization: Bearer cpb_tutoken
```

5. Si en el futuro se configura Cloudflare (Paso 5), ahí sí revisar el header `CF-Cache-Status` para confirmar que el caché funciona (`MISS` → `HIT` en la segunda request).

---

## Actualizaciones de código

Cada push a la rama `main` en GitHub dispara un deploy automático en Vercel. No hay que hacer nada manualmente.

Para subir un archivo editado: ir al archivo en GitHub → lápiz (Edit) → pegar el nuevo contenido → Commit changes. Vercel detecta el commit y redeploya en 1-2 minutos.

---

## TTL de caché por frecuencia de actualización

Referencia para cuando el admin configura `update_frequency` en cada capa:

| Frecuencia       | TTL que manda la API | Lo que cachea Cloudflare |
|------------------|----------------------|--------------------------|
| not_planned      | 90 días              | 90 días                  |
| annually         | 30 días              | 30 días                  |
| quarterly        | 7 días               | 7 días                   |
| biannually       | 7 días               | 7 días                   |
| monthly          | 1 día                | 1 día                    |
| fortnightly      | 1 día                | 1 día                    |
| weekly           | 1 hora               | 1 hora                   |
| daily            | 1 hora               | 1 hora                   |
| irregular        | 6 horas              | 6 horas                  |
| unknown          | 6 horas              | 6 horas                  |
| continual        | no-store             | no cachea (BYPASS)       |
