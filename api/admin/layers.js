/**
 * api/admin/layers.js — Capas consolidado
 *
 * Rutas (via vercel.json rewrites):
 *   PATCH  /api/admin/layers?id=           → editar capa
 *   GET    /api/admin/layers/fields?id=    → ?sub=fields
 *   POST   /api/admin/layers/discover?id=  → ?sub=discover
 */

const { getDb }          = require('../_turso');
const { initSchema }     = require('../_db');
const { requireAdmin }   = require('../_auth');
const { checkOrigin }    = require('../_cors');
const { getConnector }   = require('../_connectors/_registry');
const { id, now, ok, err, safeJson } = require('../_utils');

const EDITABLE = ['included', 'name_alias', 'domain', 'update_frequency', 'notes'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });

  await initSchema();
  const session = requireAdmin(req, res);
  if (!session) return;

  const db       = getDb();
  const sub      = req.query.sub;
  const layerId  = req.query.id;
  const sourceId = req.query.source_id;

  // ── LIST LAYERS BY SOURCE ─────────────────────────────────────────────────
  // GET /api/admin/layers?source_id=xxx — carga liviana solo con columnas del panel
  if (req.method === 'GET' && sourceId) {
    const result = await db.execute({
      sql: 'SELECT id, name_source, name_alias, domain, update_frequency, geometry_type, feature_count, included FROM layers WHERE source_id = ?',
      args: [sourceId],
    });
    // Ordenar en JS para respetar tildes y caracteres especiales del español
    // (SQLite ORDER BY usa collation binaria — las tildes quedan al final)
    const sorted = result.rows.slice().sort((a, b) => {
      const na = (a.name_alias || a.name_source || '').normalize('NFC');
      const nb = (b.name_alias || b.name_source || '').normalize('NFC');
      return na.localeCompare(nb, 'es', { sensitivity: 'base' });
    });
    return ok(res, { layers: sorted });
  }

  if (!layerId) return err(res, 400, 'Se requiere id');

  // ── FIELDS LIST ──────────────────────────────────────────────────────────
  if (sub === 'fields') {
    if (req.method !== 'GET') return err(res, 405, 'Method not allowed');
    const result = await db.execute({ sql: 'SELECT id, layer_id, source_id, name_source, name_alias, type, included, metadata, notes, discovered_at FROM fields WHERE layer_id = ? ORDER BY rowid ASC', args: [layerId] });
    return ok(res, { fields: result.rows });
  }

  // ── DISCOVER FIELDS ──────────────────────────────────────────────────────
  if (sub === 'discover') {
    if (req.method !== 'POST') return err(res, 405, 'Method not allowed');
    const layerResult = await db.execute({ sql: 'SELECT l.id, l.name_source, l.source_id, s.data_format, s.connection_params FROM layers l JOIN sources s ON s.id = l.source_id WHERE l.id = ? LIMIT 1', args: [layerId] });
    if (!layerResult.rows.length) return err(res, 404, 'Capa no encontrada');
    const layer  = layerResult.rows[0];
    const entry  = getConnector(layer.data_format);
    if (!entry?.implemented) return err(res, 400, `Conector no disponible: ${layer.data_format}`);
    const params = safeJson(layer.connection_params, {});
    const fields = await entry.connector.getFields(params, layer.name_source);
    if (!fields?.length) return ok(res, { ok: true, total: 0, added: 0, skipped: 0 });
    const existingResult = await db.execute({ sql: 'SELECT id, name_source FROM fields WHERE layer_id = ?', args: [layerId] });
    const existingMap = new Map(existingResult.rows.map(r => [r.name_source, r.id]));
    let added = 0, skipped = 0;
    const ts = now();
    for (const field of fields) {
      const meta    = field.metadata || {};
      const metaStr = JSON.stringify(meta);
      const type    = meta.type || 'unknown';
      if (existingMap.has(field.name)) {
        await db.execute({ sql: 'UPDATE fields SET metadata = ?, type = ?, discovered_at = ? WHERE id = ?', args: [metaStr, type, ts, existingMap.get(field.name)] });
        skipped++;
      } else {
        await db.execute({ sql: 'INSERT INTO fields (id, layer_id, source_id, name_source, name_alias, type, included, metadata, discovered_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)', args: [id('fld'), layerId, layer.source_id, field.name, meta.label || null, type, metaStr, ts] });
        added++;
      }
    }
    return ok(res, { ok: true, total: fields.length, added, skipped });
  }

  // ── SAMPLE (preview de datos) ──────────────────────────────────────────────
  if (sub === 'sample') {
    if (req.method !== 'GET') return err(res, 405, 'Method not allowed');
    const layerResult = await db.execute({
      sql: 'SELECT l.id, l.name_source, s.data_format, s.connection_params FROM layers l JOIN sources s ON s.id = l.source_id WHERE l.id = ? LIMIT 1',
      args: [layerId],
    });
    if (!layerResult.rows.length) return err(res, 404, 'Capa no encontrada');
    const layer  = layerResult.rows[0];
    const entry  = getConnector(layer.data_format);
    if (!entry?.implemented) return err(res, 400, `Conector no disponible: ${layer.data_format}`);
    const params = safeJson(layer.connection_params, {});
    const count  = Math.min(parseInt(req.query.count) || 5, 10);
    try {
      const sample = await entry.connector.getSample(params, layer.name_source, count);
      return ok(res, { layer_id: layerId, layer_name: layer.name_source, features: sample.features || [], total: sample.total || 0 });
    } catch (e) {
      return err(res, 502, `Error al obtener preview: ${e.message}`);
    }
  }

  // ── PATCH capa ───────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const body    = req.body || {};
    const updates = Object.entries(body).filter(([k]) => EDITABLE.includes(k)).reduce((a, [k, v]) => ({ ...a, [k]: v }), {});
    if (!Object.keys(updates).length) return err(res, 400, `Campos editables: ${EDITABLE.join(', ')}`);
    const check = await db.execute({ sql: 'SELECT id FROM layers WHERE id = ? LIMIT 1', args: [layerId] });
    if (!check.rows.length) return err(res, 404, 'Capa no encontrada');
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.execute({ sql: `UPDATE layers SET ${setClauses} WHERE id = ?`, args: [...Object.values(updates), layerId] });
    const updated = await db.execute({ sql: 'SELECT * FROM layers WHERE id = ? LIMIT 1', args: [layerId] });
    return ok(res, { layer: updated.rows[0] });
  }

  return err(res, 405, 'Method not allowed');
};
