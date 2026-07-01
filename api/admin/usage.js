/**
 * api/admin/usage.js — Analytics de uso de la API
 *
 * GET /api/admin/usage
 * Agrega datos de api_usage para el panel de analytics.
 * Limitado a los últimos 30 días para no saturar Turso.
 */

const { getDb }        = require('../_turso');
const { initSchema }   = require('../_db');
const { requireAdmin } = require('../_auth');
const { checkOrigin }  = require('../_cors');
const { ok }           = require('../_utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  await initSchema();
  const session = requireAdmin(req, res);
  if (!session) return;

  const db   = getDb();
  const days = parseInt(req.query.days) || 30;
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

  const [totalRes, byDayRes, avgRes, topKeysRes, errorsRes] = await Promise.all([
    // Total requests en el período
    db.execute({ sql: 'SELECT COUNT(*) AS total FROM api_usage WHERE requested_at >= ?', args: [cutoff] }),

    // Requests por día (últimos 7 días)
    db.execute({
      sql: `SELECT DATE(requested_at) AS day, COUNT(*) AS requests, AVG(response_ms) AS avg_ms
            FROM api_usage WHERE requested_at >= DATE('now', '-7 days')
            GROUP BY DATE(requested_at) ORDER BY day ASC`,
      args: [],
    }),

    // Tiempo de respuesta promedio
    db.execute({ sql: 'SELECT AVG(response_ms) AS avg_ms, MAX(response_ms) AS max_ms FROM api_usage WHERE requested_at >= ?', args: [cutoff] }),

    // Top 5 keys por uso
    db.execute({
      sql: `SELECT u.key_id, k.label, COUNT(*) AS requests, MAX(u.requested_at) AS last_used
            FROM api_usage u LEFT JOIN api_keys k ON k.id = u.key_id
            WHERE u.requested_at >= ?
            GROUP BY u.key_id ORDER BY requests DESC LIMIT 5`,
      args: [cutoff],
    }),

    // Errores (status >= 400)
    db.execute({ sql: 'SELECT COUNT(*) AS total FROM api_usage WHERE status_code >= 400 AND requested_at >= ?', args: [cutoff] }),
  ]);

  const total = totalRes.rows[0]?.total || 0;

  return ok(res, {
    period_days:     days,
    total_requests:  total,
    error_count:     errorsRes.rows[0]?.total || 0,
    error_rate:      total > 0 ? Math.round((errorsRes.rows[0]?.total || 0) / total * 100) : 0,
    avg_response_ms: Math.round(avgRes.rows[0]?.avg_ms || 0),
    max_response_ms: avgRes.rows[0]?.max_ms || 0,
    by_day:          byDayRes.rows.map(r => ({ day: r.day, requests: r.requests, avg_ms: Math.round(r.avg_ms || 0) })),
    top_keys:        topKeysRes.rows.map(r => ({ key_id: r.key_id, label: r.label || '(sin nombre)', requests: r.requests, last_used: r.last_used })),
  });
};
