/**
 * api/admin/admin-keys.js — Vista admin de todas las API keys
 *
 * GET    /api/admin/admin-keys          → lista todas las keys con info de usuario
 * DELETE /api/admin/admin-keys?id=      → revoca cualquier key
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

  const db    = getDb();
  const keyId = req.query.id;

  if (req.method === 'GET') {
    const result = await db.execute(`
      SELECT
        k.id, k.label, k.type, k.tier, k.rate_limit, k.active,
        k.created_at, k.last_used_at,
        u.id AS user_id, u.email AS user_email, u.name AS user_name
      FROM api_keys k
      LEFT JOIN users u ON u.id = k.user_id
      ORDER BY k.created_at DESC
    `);
    return ok(res, { keys: result.rows });
  }

  if (req.method === 'DELETE') {
    if (!keyId) return err(res, 400, 'Se requiere ?id=');
    const check = await db.execute({ sql: 'SELECT id FROM api_keys WHERE id = ? LIMIT 1', args: [keyId] });
    if (!check.rows.length) return err(res, 404, 'Key no encontrada');
    await db.execute({ sql: 'UPDATE api_keys SET active = 0 WHERE id = ?', args: [keyId] });
    return ok(res, { ok: true });
  }

  return err(res, 405, 'Method not allowed');
};
