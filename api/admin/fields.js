/**
 * api/admin/fields.js — Campos consolidado
 *
 * Rutas (via vercel.json rewrites):
 *   PATCH /api/admin/fields?id=          → editar campo
 *   GET   /api/admin/fields/sample?id=   → ?sub=sample
 */

const { getDb }          = require('../_turso');
const { initSchema }     = require('../_db');
const { requireAdmin }   = require('../_auth');
const { checkOrigin }    = require('../_cors');
const { getConnector }   = require('../_connectors/_registry');
const { ok, err, safeJson } = require('../_utils');

const EDITABLE   = ['included', 'name_alias', 'notes'];
const SAMPLE_SIZE = 100;

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });

  await initSchema();
  const session = requireAdmin(req, res);
  if (!session) return;

  const db      = getDb();
  const sub     = req.query.sub;
  const fieldId = req.query.id;

  if (!fieldId) return err(res, 400, 'Se requiere id');

  // ── SAMPLE ───────────────────────────────────────────────────────────────
  if (sub === 'sample') {
    if (req.method !== 'GET') return err(res, 405, 'Method not allowed');
    const result = await db.execute({ sql: 'SELECT f.id, f.name_source, f.name_alias, l.name_source AS layer_name, s.data_format, s.connection_params FROM fields f JOIN layers l ON l.id = f.layer_id JOIN sources s ON s.id = f.source_id WHERE f.id = ? LIMIT 1', args: [fieldId] });
    if (!result.rows.length) return err(res, 404, 'Campo no encontrado');
    const field = result.rows[0];
    const entry = getConnector(field.data_format);
    if (!entry?.implemented) return err(res, 400, `Conector no disponible: ${field.data_format}`);
    const params = safeJson(field.connection_params, {});
    const { features, total } = await entry.connector.getSample(params, field.layer_name, SAMPLE_SIZE);
    const uniqueValues = [...new Set(features.map(f => f[field.name_source] ?? f?.properties?.[field.name_source]).filter(v => v !== null && v !== undefined && v !== '').map(v => String(v)))].slice(0, 10);
    return ok(res, { field: field.name_alias || field.name_source, values: uniqueValues, total_features_sampled: total });
  }

  // ── PATCH campo ──────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const body    = req.body || {};
    const updates = Object.entries(body).filter(([k]) => EDITABLE.includes(k)).reduce((a, [k, v]) => ({ ...a, [k]: v }), {});
    if (!Object.keys(updates).length) return err(res, 400, `Campos editables: ${EDITABLE.join(', ')}`);
    const check = await db.execute({ sql: 'SELECT id FROM fields WHERE id = ? LIMIT 1', args: [fieldId] });
    if (!check.rows.length) return err(res, 404, 'Campo no encontrado');
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.execute({ sql: `UPDATE fields SET ${setClauses} WHERE id = ?`, args: [...Object.values(updates), fieldId] });
    const updated = await db.execute({ sql: 'SELECT * FROM fields WHERE id = ? LIMIT 1', args: [fieldId] });
    return ok(res, { field: updated.rows[0] });
  }

  return err(res, 405, 'Method not allowed');
};
