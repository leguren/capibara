/**
 * api/user.js — Dashboard de usuario consolidado
 *
 * Rutas (via vercel.json rewrites):
 *   GET/POST/PATCH/DELETE /api/user/keys    → ?sub=keys
 *   PATCH                 /api/user/profile → ?sub=profile
 */

const { getDb }       = require('./_turso');
const { initSchema }  = require('./_db');
const { requireAuth } = require('./_auth');
const { checkOrigin } = require('./_cors');
const { generateApiKey, hashApiKey } = require('./_auth');
const { id, now, ok, err } = require('./_utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });

  await initSchema();
  const session = requireAuth(req, res);
  if (!session) return;

  const sub    = req.query.sub;
  const db     = getDb();
  const userId = session.userId;

  // ── KEYS ────────────────────────────────────────────────────────────────
  if (sub === 'keys') {
    if (req.method === 'GET') {
      const result = await db.execute({ sql: 'SELECT id, label, type, tier, rate_limit, active, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC', args: [userId] });
      return ok(res, { keys: result.rows });
    }

    if (req.method === 'POST') {
      const label = (req.body?.label || '').trim();
      const type  = req.body?.type === 'mcp' ? 'mcp' : 'rest';
      if (!label) return err(res, 400, 'Se requiere un nombre (label) para la key');
      const countResult = await db.execute({ sql: 'SELECT COUNT(*) AS total FROM api_keys WHERE user_id = ? AND active = 1', args: [userId] });
      if ((countResult.rows[0]?.total || 0) >= 10) return err(res, 400, 'Límite de 10 API keys activas por usuario');
      const token = generateApiKey();
      const hash  = hashApiKey(token);
      const keyId = id('key');
      const ts    = now();
      await db.execute({ sql: 'INSERT INTO api_keys (id, user_id, label, key_hash, type, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)', args: [keyId, userId, label, hash, type, ts] });
      return ok(res, { id: keyId, label, type, active: 1, created_at: ts, token, warning: 'Guardá este token ahora. No se puede recuperar después.' }, 201);
    }

    if (req.method === 'PATCH') {
      const keyId = req.query.id;
      if (!keyId) return err(res, 400, 'Se requiere ?id=');
      const updates = {};
      if (req.body?.label  !== undefined) updates.label  = req.body.label.trim();
      if (req.body?.active !== undefined) updates.active = req.body.active ? 1 : 0;
      if (!Object.keys(updates).length)   return err(res, 400, 'Nada que actualizar');
      const check = await db.execute({ sql: 'SELECT id FROM api_keys WHERE id = ? AND user_id = ? LIMIT 1', args: [keyId, userId] });
      if (!check.rows.length) return err(res, 404, 'Key no encontrada');
      const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      await db.execute({ sql: `UPDATE api_keys SET ${setClauses} WHERE id = ?`, args: [...Object.values(updates), keyId] });
      return ok(res, { ok: true });
    }

    if (req.method === 'DELETE') {
      const keyId = req.query.id;
      if (!keyId) return err(res, 400, 'Se requiere ?id=');
      const check = await db.execute({ sql: 'SELECT id FROM api_keys WHERE id = ? AND user_id = ? LIMIT 1', args: [keyId, userId] });
      if (!check.rows.length) return err(res, 404, 'Key no encontrada');
      await db.execute({ sql: 'DELETE FROM api_keys WHERE id = ?', args: [keyId] });
      return ok(res, { ok: true, deleted: keyId });
    }

    return err(res, 405, 'Method not allowed');
  }

  // ── PROFILE ──────────────────────────────────────────────────────────────
  if (sub === 'profile') {
    if (req.method !== 'PATCH') return err(res, 405, 'Method not allowed');
    const name = req.body?.name?.trim();
    if (!name) return err(res, 400, 'Se requiere name');
    await db.execute({ sql: 'UPDATE users SET name = ? WHERE id = ?', args: [name, userId] });
    return ok(res, { ok: true });
  }

  return err(res, 404, 'Ruta no encontrada');
};
