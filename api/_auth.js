/**
 * api/_auth.js — Middleware de autenticación compartido
 *
 * El prefijo _ impide que Vercel lo exponga como endpoint HTTP.
 * Dos mecanismos de autenticación completamente separados:
 *
 * 1. SESIÓN OAUTH (para humanos — panel admin y dashboard)
 *    - Flujo: Google OAuth → cookie 'capibara_session'
 *    - La cookie contiene un JWT firmado con SESSION_SECRET
 *    - Funciones: verifySession(req), requireAuth(req, res), requireAdmin(req, res)
 *
 * 2. API KEY (para clientes B2B — /api/geo/1/* y /api/mcp)
 *    - Header: Authorization: Bearer cpb_live_xK9m...
 *    - El token se hashea (SHA-256) y se busca en api_keys
 *    - Funciones: verifyApiKey(req, db)
 *
 * Variables de entorno requeridas:
 *   SESSION_SECRET → string aleatorio largo para firmar/verificar JWTs de sesión
 *   SESSION_TTL_MS → duración de la sesión en ms (default: 7 días)
 */

const crypto = require('crypto');
const { getDb } = require('./_turso');
const { now }   = require('./_utils');

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const SESSION_COOKIE  = 'capibara_session';
const SESSION_TTL_MS  = parseInt(process.env.SESSION_TTL_MS || String(7 * 24 * 60 * 60 * 1000), 10);
const API_KEY_PREFIX  = 'cpb_';

// ---------------------------------------------------------------------------
// JWT mínimo firmado con HMAC-SHA256
// No usamos librerías externas (jsonwebtoken) para mantener zero dependencies.
// Estructura: base64(header).base64(payload).base64(signature)
// ---------------------------------------------------------------------------

function signSession(payload) {
  const secret  = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET no configurado');

  const data     = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig      = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifySessionToken(token) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;

  const dotIndex = token.lastIndexOf('.');
  if (dotIndex === -1) return null;

  const data        = token.slice(0, dotIndex);
  const receivedSig = token.slice(dotIndex + 1);
  const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('base64url');

  try {
    const a = Buffer.from(receivedSig, 'base64url');
    const b = Buffer.from(expectedSig, 'base64url');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!payload.userId || !payload.exp) return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/**
 * parseCookies(req) → { [name]: string }
 */
function parseCookies(req) {
  const header = req.headers['cookie'] || '';
  return Object.fromEntries(
    header.split(';')
      .map(c => c.trim().split('='))
      .filter(([k]) => k)
      .map(([k, ...v]) => [k.trim(), decodeURIComponent(v.join('=').trim())])
  );
}

/**
 * setSessionCookie(res, token) → void
 *
 * Setea la cookie de sesión con atributos de seguridad:
 *   HttpOnly  → inaccesible desde JS del cliente
 *   Secure    → solo HTTPS (en producción)
 *   SameSite  → Lax para protección CSRF básica
 *   Max-Age   → TTL de la sesión en segundos
 */
function setSessionCookie(res, token) {
  const maxAge    = Math.floor(SESSION_TTL_MS / 1000);
  const secure    = process.env.VERCEL_ENV ? '; Secure' : '';
  const cookieStr = `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly${secure}; SameSite=Lax; Max-Age=${maxAge}; Path=/`;
  res.setHeader('Set-Cookie', cookieStr);
}

/**
 * clearSessionCookie(res) → void
 */
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`);
}

// ---------------------------------------------------------------------------
// Sesión OAuth — funciones exportadas
// ---------------------------------------------------------------------------

/**
 * createSession(user) → token string
 *
 * Crea un token de sesión firmado para el usuario dado.
 * Llamar después de autenticar con Google OAuth.
 */
function createSession(user) {
  return signSession({
    userId: user.id,
    email:  user.email,
    role:   user.role,
    exp:    Date.now() + SESSION_TTL_MS,
  });
}

/**
 * verifySession(req) → payload | null
 *
 * Lee y verifica la cookie de sesión.
 * Devuelve el payload del token o null si es inválido/inexistente.
 */
function verifySession(req) {
  const cookies = parseCookies(req);
  const token   = cookies[SESSION_COOKIE];
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * requireAuth(req, res) → session | null
 *
 * Middleware de autenticación para endpoints que requieren usuario logueado.
 * Si no hay sesión válida, escribe 401 y devuelve null.
 *
 * Uso en handlers:
 *   const session = requireAuth(req, res);
 *   if (!session) return;   ← la respuesta 401 ya fue escrita
 */
function requireAuth(req, res) {
  const session = verifySession(req);
  if (!session) {
    res.status(401).json({ error: 'No autenticado' });
    return null;
  }
  return session;
}

/**
 * requireAdmin(req, res) → session | null
 *
 * Como requireAuth, pero además verifica que el usuario sea admin.
 * Si no es admin, escribe 403 y devuelve null.
 */
function requireAdmin(req, res) {
  const session = requireAuth(req, res);
  if (!session) return null;

  if (session.role !== 'admin') {
    res.status(403).json({ error: 'Acceso denegado' });
    return null;
  }
  return session;
}

// ---------------------------------------------------------------------------
// API Key — funciones exportadas
// ---------------------------------------------------------------------------

/**
 * hashApiKey(token) → string
 *
 * SHA-256 del token. Se usa para almacenar y verificar API keys
 * sin guardar el token en claro en la DB.
 */
function hashApiKey(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * generateApiKey() → string
 *
 * Genera un token de API key con prefijo reconocible.
 * Formato: cpb_<48 bytes hex>
 * El token se muestra al usuario UNA SOLA VEZ y nunca se almacena.
 */
function generateApiKey() {
  const random = crypto.randomBytes(24).toString('hex');
  return `${API_KEY_PREFIX}${random}`;
}

/**
 * verifyApiKey(req, db?) → { key, user } | null
 *
 * Lee el header Authorization: Bearer <token>, hashea el token,
 * lo busca en api_keys, y devuelve la key y el usuario asociado.
 * También actualiza last_used_at y registra el uso en api_usage.
 *
 * Si el token es inválido, inexistente o la key está inactiva → null.
 */
async function verifyApiKey(req) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7).trim();
  if (!token.startsWith(API_KEY_PREFIX)) return null;

  const hash = hashApiKey(token);
  const db   = getDb();

  try {
    const result = await db.execute({
      sql: `
        SELECT
          k.id, k.user_id, k.label, k.type, k.tier, k.rate_limit, k.active,
          u.email, u.name, u.role, u.tier AS user_tier
        FROM api_keys k
        JOIN users u ON u.id = k.user_id
        WHERE k.key_hash = ? AND k.active = 1
        LIMIT 1
      `,
      args: [hash],
    });

    if (!result.rows.length) return null;

    const row = result.rows[0];

    // Actualizar last_used_at en background (no bloquea la respuesta)
    db.execute({
      sql:  'UPDATE api_keys SET last_used_at = ? WHERE id = ?',
      args: [now(), row.id],
    }).catch(e => console.error('[_auth] last_used_at update failed:', e.message));

    return {
      keyId:    row.id,
      userId:   row.user_id,
      type:     row.type,
      tier:     row.tier || row.user_tier || null,
      rateLimit: row.rate_limit,
    };
  } catch (e) {
    console.error('[_auth] verifyApiKey error:', e.message);
    return null;
  }
}

/**
 * requireApiKey(req, res) → keyInfo | null
 *
 * Middleware para endpoints /api/geo/1/* y /api/mcp.
 * Si la key es inválida, escribe 401 y devuelve null.
 */
async function requireApiKey(req, res) {
  const keyInfo = await verifyApiKey(req);
  if (!keyInfo) {
    res.status(401).json({ error: 'API key inválida o inactiva' });
    return null;
  }
  return keyInfo;
}

module.exports = {
  createSession,
  verifySession,
  requireAuth,
  requireAdmin,
  setSessionCookie,
  clearSessionCookie,
  generateApiKey,
  hashApiKey,
  requireApiKey,
};
