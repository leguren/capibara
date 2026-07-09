/**
 * api/_ratelimit.js — Rate limiting compartido
 *
 * El prefijo _ impide que Vercel lo exponga como endpoint HTTP.
 *
 * Implementación basada en DB (tabla rate_limit_hits), no en memoria:
 * en Vercel serverless cada invocación puede caer en una instancia
 * distinta, así que un contador en memoria de proceso no sirve para
 * limitar de forma confiable. Un round-trip extra a Turso es aceptable
 * dentro del presupuesto de 10s del plan Hobby.
 *
 * Uso típico:
 *   const { checkRateLimit, getClientIp } = require('../_ratelimit');
 *   const rl = await checkRateLimit(db, `key:${keyInfo.keyId}`, limit, 60);
 *   if (!rl.allowed) {
 *     res.setHeader('Retry-After', String(rl.retryAfter));
 *     return res.status(429).json({ error: 'Límite de requests excedido' });
 *   }
 */

/**
 * checkRateLimit(db, bucket, limit, windowSeconds) → { allowed, retryAfter? }
 *
 * bucket: identificador de quién está siendo limitado, ej. 'key:key_123'
 *         o 'demo_ip:1.2.3.4'. Buckets distintos no comparten cuota.
 * limit:  cantidad máxima de requests permitidas dentro de la ventana.
 * windowSeconds: tamaño de la ventana deslizante, en segundos.
 *
 * Antes de contar, borra los hits vencidos de ESE bucket — mantiene la
 * tabla chica sin necesitar un cron de limpieza aparte.
 */
async function checkRateLimit(db, bucket, limit, windowSeconds = 60) {
  const cutoff = new Date(Date.now() - windowSeconds * 1000).toISOString();

  await db.execute({
    sql:  'DELETE FROM rate_limit_hits WHERE bucket = ? AND requested_at < ?',
    args: [bucket, cutoff],
  }).catch(e => console.error('[_ratelimit] cleanup failed:', e.message));

  const result = await db.execute({
    sql:  'SELECT COUNT(*) AS total FROM rate_limit_hits WHERE bucket = ? AND requested_at >= ?',
    args: [bucket, cutoff],
  });
  const count = result.rows[0]?.total || 0;

  if (count >= limit) {
    return { allowed: false, retryAfter: windowSeconds };
  }

  // Registrar el hit en background — no bloquea la respuesta.
  db.execute({
    sql:  'INSERT INTO rate_limit_hits (bucket, requested_at) VALUES (?, ?)',
    args: [bucket, new Date().toISOString()],
  }).catch(e => console.error('[_ratelimit] insert failed:', e.message));

  return { allowed: true };
}

/**
 * getClientIp(req) → string
 *
 * Vercel expone la IP real del cliente en x-forwarded-for (puede traer
 * una lista si hay proxies intermedios — nos quedamos con la primera).
 */
function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

module.exports = { checkRateLimit, getClientIp };
