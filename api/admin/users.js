/**
 * api/admin/users.js — Gestión de usuarios del sistema
 *
 * GET /api/admin/users → lista todos los usuarios con conteo de keys
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

  const db = getDb();

  const result = await db.execute(`
    SELECT
      u.id, u.email, u.name, u.role, u.created_at, u.last_login,
      COUNT(CASE WHEN k.active = 1 THEN 1 END) AS keys_active,
      COUNT(k.id) AS keys_total,
      MAX(k.last_used_at) AS last_api_use
    FROM users u
    LEFT JOIN api_keys k ON k.user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `);

  return ok(res, { users: result.rows });
};
