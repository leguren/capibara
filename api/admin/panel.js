/**
 * api/admin/panel.js — Endpoints consolidados del panel admin
 *
 * Rutas (via vercel.json rewrites):
 *   GET /api/admin/stats       → ?sub=stats
 *   GET /api/admin/usage       → ?sub=usage
 *   GET /api/admin/users       → ?sub=users
 *   GET /api/admin/admin-keys  → ?sub=admin-keys
 *   DELETE /api/admin/admin-keys?id= → ?sub=admin-keys
 *
 * Consolidado en un único handler para respetar el límite de 12
 * serverless functions del plan Hobby de Vercel.
 */

const { getDb }        = require('../_turso');
const { initSchema }   = require('../_db');
const { requireAdmin } = require('../_auth');
const { checkOrigin }  = require('../_cors');
const { ok, err }      = require('../_utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });

  await initSchema();
  const session = requireAdmin(req, res);
  if (!session) return;

  const db  = getDb();
  const sub = req.query.sub;

  // ── STATS ─────────────────────────────────────────────────────────────────
  if (sub === 'stats') {
    if (req.method !== 'GET') return err(res, 405, 'Method not allowed');

    const [sourcesRes, layersRes, fieldsRes, pubRes] = await Promise.all([
      db.execute("SELECT COUNT(*) AS total, SUM(CASE WHEN status='ok' THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS error FROM sources WHERE included=1"),
      db.execute('SELECT COUNT(*) AS total, SUM(CASE WHEN included=1 THEN 1 ELSE 0 END) AS included FROM layers'),
      db.execute('SELECT COUNT(*) AS total, SUM(CASE WHEN included=1 THEN 1 ELSE 0 END) AS included FROM fields'),
      db.execute('SELECT version_label, created_at, published_by FROM publications ORDER BY created_at DESC LIMIT 1'),
    ]);

    return ok(res, {
      sources: { total: sourcesRes.rows[0]?.total || 0, ok: sourcesRes.rows[0]?.ok || 0, error: sourcesRes.rows[0]?.error || 0 },
      layers:  { total: layersRes.rows[0]?.total || 0, included: layersRes.rows[0]?.included || 0 },
      fields:  { total: fieldsRes.rows[0]?.total || 0, included: fieldsRes.rows[0]?.included || 0 },
      latest_publication: pubRes.rows.length ? {
        version: pubRes.rows[0].version_label, created_at: pubRes.rows[0].created_at, published_by: pubRes.rows[0].published_by,
      } : null,
    });
  }

  // ── USAGE / ANALYTICS ─────────────────────────────────────────────────────
  if (sub === 'usage') {
    if (req.method !== 'GET') return err(res, 405, 'Method not allowed');

    const days   = Math.min(parseInt(req.query.days) || 30, 90);
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();

    const [totalRes, byDayRes, avgRes, topKeysRes, errorsRes] = await Promise.all([
      db.execute({ sql: 'SELECT COUNT(*) AS total FROM api_usage WHERE requested_at >= ?', args: [cutoff] }),
      db.execute({ sql: "SELECT DATE(requested_at) AS day, COUNT(*) AS requests, AVG(response_ms) AS avg_ms FROM api_usage WHERE requested_at >= DATE('now','-7 days') GROUP BY DATE(requested_at) ORDER BY day ASC", args: [] }),
      db.execute({ sql: 'SELECT AVG(response_ms) AS avg_ms, MAX(response_ms) AS max_ms FROM api_usage WHERE requested_at >= ?', args: [cutoff] }),
      db.execute({ sql: 'SELECT u.key_id, k.label, COUNT(*) AS requests, MAX(u.requested_at) AS last_used FROM api_usage u LEFT JOIN api_keys k ON k.id=u.key_id WHERE u.requested_at >= ? GROUP BY u.key_id ORDER BY requests DESC LIMIT 5', args: [cutoff] }),
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
      by_day:   byDayRes.rows.map(r => ({ day: r.day, requests: r.requests, avg_ms: Math.round(r.avg_ms || 0) })),
      top_keys: topKeysRes.rows.map(r => ({ key_id: r.key_id, label: r.label || '(sin nombre)', requests: r.requests, last_used: r.last_used })),
    });
  }

  // ── USERS ─────────────────────────────────────────────────────────────────
  if (sub === 'users') {
    if (req.method !== 'GET') return err(res, 405, 'Method not allowed');

    const result = await db.execute(`
      SELECT u.id, u.email, u.name, u.role, u.created_at, u.last_login,
        COUNT(CASE WHEN k.active=1 THEN 1 END) AS keys_active,
        COUNT(k.id) AS keys_total,
        MAX(k.last_used_at) AS last_api_use
      FROM users u LEFT JOIN api_keys k ON k.user_id=u.id
      GROUP BY u.id ORDER BY u.created_at DESC
    `);
    return ok(res, { users: result.rows });
  }

  // ── ADMIN KEYS ────────────────────────────────────────────────────────────
  if (sub === 'admin-keys') {
    if (req.method === 'GET') {
      const result = await db.execute(`
        SELECT k.id, k.label, k.type, k.tier, k.active, k.created_at, k.last_used_at,
          u.id AS user_id, u.email AS user_email, u.name AS user_name
        FROM api_keys k LEFT JOIN users u ON u.id=k.user_id
        ORDER BY k.created_at DESC
      `);
      return ok(res, { keys: result.rows });
    }

    if (req.method === 'DELETE') {
      const keyId = req.query.id;
      if (!keyId) return err(res, 400, 'Se requiere ?id=');
      const check = await db.execute({ sql: 'SELECT id FROM api_keys WHERE id=? LIMIT 1', args: [keyId] });
      if (!check.rows.length) return err(res, 404, 'Key no encontrada');
      await db.execute({ sql: 'UPDATE api_keys SET active=0 WHERE id=?', args: [keyId] });
      return ok(res, { ok: true });
    }

    return err(res, 405, 'Method not allowed');
  }

  return err(res, 400, 'Sub-ruta no reconocida. Opciones: stats, usage, users, admin-keys');
};
