/**
 * api/_cors.js — Verificación de origen compartida
 *
 * El prefijo _ impide que Vercel lo exponga como endpoint HTTP.
 * Importado por todos los handlers de la API.
 *
 * Estrategia:
 *   - En cualquier deploy de Vercel (producción o preview): acepta solo
 *     ALLOWED_ORIGINS y ALLOWED_PATTERNS.
 *   - En desarrollo local (sin VERCEL_ENV): permisivo para no bloquear el dev.
 *
 * Los headers CORS reales (Access-Control-Allow-Origin, etc.) los agrega
 * vercel.json a nivel de CDN. Esta función solo verifica el origen del request
 * en el servidor — es la barrera real contra llamadas no autorizadas.
 *
 * Separación de responsabilidades:
 *   vercel.json  → agrega headers CORS en la respuesta (para el browser)
 *   checkOrigin  → bloquea requests de orígenes no autorizados (seguridad real)
 */

// Dominios exactos autorizados a llamar a las APIs del panel y la API pública.
// capibara-ten.vercel.app es el dominio real de producción (Vercel, sin dominio
// propio todavía). También cubierto por ALLOWED_PATTERNS más abajo, pero se
// deja explícito acá para que quede claro y no dependa solo del patrón.
const ALLOWED_ORIGINS = new Set([
  'https://capibara-ten.vercel.app',
  // Agregar acá un dominio propio (ej. 'https://capibara.io') si se
  // configura uno en el futuro — ver docs/deploy.md.
]);

// Patrones de preview deploys de Vercel (capibara-<hash>-<usuario>.vercel.app)
const ALLOWED_PATTERNS = [
  'https://capibara-',
];

/**
 * extractOrigin(urlString) → 'https://host' | null
 *
 * Parsea con URL() y extrae solo protocolo+host, sin path ni query.
 * Evita bypasses tipo: "https://capibara.vercel.app.atacante.com"
 * que pasarían un startsWith() naive.
 */
function extractOrigin(urlString) {
  try {
    const u = new URL(urlString);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * checkOrigin(req) → boolean
 *
 * Devuelve true si el request viene de un origen autorizado.
 * Usar en cada handler antes de procesar:
 *   if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
 */
function checkOrigin(req) {
  // VERCEL_ENV la inyecta Vercel automáticamente en todo deploy real.
  // Solo queda permisivo en desarrollo local genuino (fuera de Vercel).
  if (!process.env.VERCEL_ENV) return true;

  const origin        = req.headers['origin']  || '';
  const referer       = req.headers['referer'] || '';
  const refererOrigin = referer ? extractOrigin(referer) : null;
  const host          = req.headers['host'] || '';
  const fwdHost       = req.headers['x-forwarded-host'] || host;

  // Same-origin: el browser pide /api/* al mismo host que sirve la página.
  // Origin y referer pueden venir vacíos — verificamos contra el host directamente.
  if (!origin && !referer && fwdHost) {
    for (const allowed of ALLOWED_ORIGINS) {
      if (allowed === `https://${fwdHost}`) return true;
    }
    for (const pattern of ALLOWED_PATTERNS) {
      if (`https://${fwdHost}`.startsWith(pattern) && fwdHost.endsWith('.vercel.app')) return true;
    }
  }

  for (const allowed of ALLOWED_ORIGINS) {
    if (origin === allowed) return true;
    if (refererOrigin === allowed) return true;
  }
  for (const pattern of ALLOWED_PATTERNS) {
    if (origin.startsWith(pattern) && origin.endsWith('.vercel.app')) return true;
    if (refererOrigin && refererOrigin.startsWith(pattern) && refererOrigin.endsWith('.vercel.app')) return true;
  }

  // Requests sin origin/referer desde no-browsers (server-to-server, health checks)
  if (!origin && !referer) {
    const ua        = req.headers['user-agent'] || '';
    const isBrowser = /Mozilla|Chrome|Safari|Firefox|Edge/i.test(ua);
    if (!isBrowser) return true;
  }

  return false;
}

// No-op intencional: los headers CORS vienen de vercel.json
function setCorsHeaders(_res) {}

module.exports = { checkOrigin, setCorsHeaders };
