# docs/architecture.md — Arquitectura general de Capibara

## Concepto

Capibara es una plataforma B2B que sirve datos geoespaciales sobre una coordenada vía API.
El cliente consulta un punto geográfico y recibe todo lo disponible de múltiples fuentes dispersas.
Capibara nunca almacena datos de las fuentes — unifica y sirve en tiempo real con caché progresiva.

Inspirado en el modelo Moody's: una sola consulta, múltiples fuentes, respuesta unificada.

## Stack

| Capa       | Tecnología                         | Razón                                     |
|------------|------------------------------------|-------------------------------------------|
| Frontend   | Vanilla JS + HTML + CSS            | Sin build step, deploy inmediato          |
| Backend    | Vercel serverless Node.js CJS      | Edge functions, deploy automático en push |
| DB         | Turso (libSQL edge)                | SQLite compatible, latencia edge          |
| Auth human | Google OAuth + cookie HMAC-SHA256  | Sin librería externa, sin estado servidor |
| Auth B2B   | API key SHA-256 hash               | Simple, seguro, auditable                 |

## Convenciones del código

Backend (Node.js CJS):
- Prefijo _ en archivos de api/: no son endpoints, son módulos compartidos.
- CommonJS (require/module.exports) — sin ESM.
- Handlers siempre module.exports = async function handler(req, res).
- Error handling: nunca exponer stack traces. Siempre { error: string }.
- IDs: id('src') → 'src_xK9mZ3YqWp2B'. Prefijos: usr, key, src, lyr, fld, pub.
- Tiempo: siempre now() → ISO 8601 UTC.

Frontend (Vanilla JS):
- Pattern IIFE: window.MODULO = (() => { 'use strict'; ... })().
- Namespace: window.CAPIBARA_*.
- Espejo CSS/JS: si existe src/auth.js → style/auth.css.
- Orden de carga en HTML: config/app.js → vocab/*.js → src/api.js → src/toast.js → src/utils.js → src/auth.js → resto.

CSS:
- Variables en base.css: única fuente de verdad. Nunca hardcodear colores ni tamaños.
- Sin frameworks: no Tailwind, no Bootstrap.
- BEM lite: .source-card, .source-card-header, .source-card-name.

## Flujo de publicación

Admin configura fuentes/capas/campos en el panel admin.
Admin hace click "Publicar".
POST /api/admin/publish:
  1. Lee sources WHERE included=1 AND status='ok'
  2. Para cada source: lee layers WHERE included=1
  3. Para cada layer: lee fields WHERE included=1
  4. Elimina auth_value/password de connection_params (stripCredentials)
  5. Genera config_json completo con el snapshot
  6. Inserta en publications con version_label semántico (v1.0.0, v1.0.1...)

La API pública lee: SELECT * FROM publications ORDER BY created_at DESC LIMIT 1.

## Versionado del API público

El prefijo /api/geo/1/ contiene el número de versión mayor.
Una versión 2 incompatible usaría /api/geo/2/.
El número es entero. No hay v en la URL.
