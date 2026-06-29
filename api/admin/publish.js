/**
 * api/admin/publish.js — Publicaciones
 *
 * GET  /api/admin/publish → lista últimas 10 publicaciones
 * POST /api/admin/publish → genera nueva publicación
 */

const { getDb }        = require('../_turso');
const { initSchema }   = require('../_db');
const { requireAdmin } = require('../_auth');
const { checkOrigin }  = require('../_cors');
const { id, now, ok, err, safeJson } = require('../_utils');

function stripCredentials(params) {
  if (!params) return {};
  const safe = { ...params };
  delete safe.auth_value; delete safe.password; delete safe.token; delete safe.api_key;
  return safe;
}

async function nextVersionLabel(db) {
  const result = await db.execute('SELECT version_label FROM publications ORDER BY created_at DESC LIMIT 1');
  if (!result.rows.length) return 'v1.0.0';
  const match = result.rows[0].version_label.match(/^v(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return 'v1.0.0';
  const [, major, minor, patch] = match.map(Number);
  return `v${major}.${minor}.${patch + 1}`;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });

  await initSchema();
  const session = requireAdmin(req, res);
  if (!session) return;

  const db = getDb();

  if (req.method === 'GET') {
    const pubId = req.query?.id;

    // Detalle de una publicación (sources + layers, sin fields)
    if (pubId) {
      const result = await db.execute({ sql: `SELECT p.id, p.version_label, p.config_json, p.published_by, p.created_at FROM publications p WHERE p.id = ?`, args: [pubId] });
      if (!result.rows.length) return err(res, 404, 'Publicación no encontrada');
      const pub = result.rows[0];
      const config = safeJson(pub.config_json, {});
      const sources = (config.sources || []).map(s => ({
        id:              s.id,
        name_source:     s.name_source,
        name_alias:      s.name_alias,
        provider_source: s.provider_source,
        provider_alias:  s.provider_alias,
        data_format:     s.data_format,
        layers: (s.layers || []).map(l => ({
          id:            l.id,
          name_source:   l.name_source,
          name_alias:    l.name_alias,
          geometry_type: l.geometry_type,
          domain:        l.domain,
        })),
      }));
      return ok(res, { id: pub.id, version_label: pub.version_label, published_by: pub.published_by, created_at: pub.created_at, sources });
    }

    // Lista de publicaciones
    const result = await db.execute(`SELECT p.id, p.version_label, p.sources_count, p.layers_count, p.fields_count, p.notes, p.published_by, p.created_at FROM publications p ORDER BY p.created_at DESC LIMIT 20`);
    return ok(res, { publications: result.rows });
  }

  if (req.method === 'POST') {
    const sourcesResult = await db.execute(`SELECT id, name_source, name_alias, provider_source, provider_alias, data_format, access_method, connection_params FROM sources WHERE included = 1 AND status = 'ok' ORDER BY created_at ASC`);
    const sources = [];
    let totalLayers = 0, totalFields = 0;

    for (const src of sourcesResult.rows) {
      const layersResult = await db.execute({ sql: `SELECT id, name_source, name_alias, abstract, domain, update_frequency, geometry_type, srs, feature_count, min_lat, max_lat, min_lon, max_lon, metadata FROM layers WHERE source_id = ? AND included = 1 ORDER BY discovered_at ASC`, args: [src.id] });
      const layers = [];
      for (const lyr of layersResult.rows) {
        const fieldsResult = await db.execute({ sql: 'SELECT id, name_source, name_alias, type, metadata FROM fields WHERE layer_id = ? AND included = 1 ORDER BY rowid ASC', args: [lyr.id] });
        const fields = fieldsResult.rows.map(f => ({ id: f.id, name_source: f.name_source, name_alias: f.name_alias, type: f.type, metadata: safeJson(f.metadata, {}) }));
        layers.push({ id: lyr.id, name_source: lyr.name_source, name_alias: lyr.name_alias, abstract: lyr.abstract, domain: lyr.domain, update_frequency: lyr.update_frequency, geometry_type: lyr.geometry_type, srs: lyr.srs, feature_count: lyr.feature_count, bbox: { min_lat: lyr.min_lat, max_lat: lyr.max_lat, min_lon: lyr.min_lon, max_lon: lyr.max_lon }, metadata: safeJson(lyr.metadata, {}), fields });
        totalFields += fields.length;
      }
      if (!layers.length) continue;
      totalLayers += layers.length;
      sources.push({ id: src.id, name_source: src.name_source, name_alias: src.name_alias, provider_source: src.provider_source, provider_alias: src.provider_alias, data_format: src.data_format, access_method: src.access_method, connection_params: stripCredentials(safeJson(src.connection_params, {})), layers });
    }

    if (!sources.length) return err(res, 400, 'No hay fuentes activas con capas incluidas');

    const config  = { version: '1', generated_at: now(), sources };
    const version = req.body?.version_label || await nextVersionLabel(db);
    const pubId   = id('pub');
    await db.execute({ sql: 'INSERT INTO publications (id, published_by, version_label, config_json, sources_count, layers_count, fields_count, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', args: [pubId, session.userId, version, JSON.stringify(config), sources.length, totalLayers, totalFields, req.body?.notes || null, now()] });
    return ok(res, { ok: true, id: pubId, version, sources_count: sources.length, layers_count: totalLayers, fields_count: totalFields, config }, 201);
  }

  if (req.method === 'DELETE') {
    const pubId = req.query?.id;
    if (!pubId) return err(res, 400, 'Falta el parámetro id');

    // Verificar que la publicación existe
    const existing = await db.execute({ sql: 'SELECT id FROM publications WHERE id = ?', args: [pubId] });
    if (!existing.rows.length) return err(res, 404, 'Publicación no encontrada');

    await db.execute({ sql: 'DELETE FROM publications WHERE id = ?', args: [pubId] });
    return ok(res, { ok: true });
  }

  return err(res, 405, 'Method not allowed');
};
