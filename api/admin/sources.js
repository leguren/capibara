/**
 * api/admin/sources.js — Fuentes de datos consolidado
 *
 * Rutas (via vercel.json rewrites):
 *   GET/POST              /api/admin/sources             → index (lista / crear)
 *   GET/PATCH/DELETE      /api/admin/sources?id=         → detalle por ID
 *   POST                  /api/admin/sources/connect     → ?sub=connect&id=
 *   POST                  /api/admin/sources/discover    → ?sub=discover&id=
 */

const { getDb }          = require('../_turso');
const { initSchema }     = require('../_db');
const { requireAdmin }   = require('../_auth');
const { checkOrigin }    = require('../_cors');
const { getConnector }   = require('../_connectors/_registry');
const { id, now, ok, err, safeJson, requireFields } = require('../_utils');

const EDITABLE = ['name_alias', 'provider_alias', 'access_method', 'connection_params', 'included', 'notes'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });

  await initSchema();
  const session = requireAdmin(req, res);
  if (!session) return;

  const db  = getDb();
  const sub = req.query.sub;
  const sid = req.query.id;

  // ── CONNECT ──────────────────────────────────────────────────────────────
  if (sub === 'connect') {
    if (req.method !== 'POST') return err(res, 405, 'Method not allowed');
    if (!sid) return err(res, 400, 'Se requiere id');
    const result = await db.execute({ sql: 'SELECT * FROM sources WHERE id = ? LIMIT 1', args: [sid] });
    if (!result.rows.length) return err(res, 404, 'Fuente no encontrada');
    const source = result.rows[0];
    const entry  = getConnector(source.data_format);
    if (!entry?.implemented) return err(res, 400, `Conector no disponible: ${source.data_format}`);
    const params        = safeJson(source.connection_params, {});
    const connectResult = await entry.connector.connect(params);
    const newStatus = connectResult.ok ? 'ok' : 'error';
    const updates   = { status: newStatus, last_checked: now(), error_message: connectResult.error || null };
    const autoPopulated = [];
    if (connectResult.ok && connectResult.info) {
      if (!source.name_source && connectResult.info.title) { updates.name_source = connectResult.info.title; autoPopulated.push('name_source'); }
      if (!source.provider_source && connectResult.info.provider) { updates.provider_source = connectResult.info.provider; autoPopulated.push('provider_source'); }
    }
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.execute({ sql: `UPDATE sources SET ${setClauses} WHERE id = ?`, args: [...Object.values(updates), sid] });
    return ok(res, { ok: connectResult.ok, status: newStatus, error: connectResult.error || null, info: connectResult.info || null, auto_populated: autoPopulated });
  }

  // ── DISCOVER LAYERS ──────────────────────────────────────────────────────
  if (sub === 'discover') {
    if (req.method !== 'POST') return err(res, 405, 'Method not allowed');
    if (!sid) return err(res, 400, 'Se requiere id');
    const srcResult = await db.execute({ sql: 'SELECT * FROM sources WHERE id = ? LIMIT 1', args: [sid] });
    if (!srcResult.rows.length) return err(res, 404, 'Fuente no encontrada');
    const source = srcResult.rows[0];

    const entry  = getConnector(source.data_format);
    if (!entry?.implemented) return err(res, 400, `Conector no disponible: ${source.data_format}`);
    const params = safeJson(source.connection_params, {});
    let layers;
    try {
      layers = await entry.connector.getLayers(params);
    } catch(e) {
      console.error('[discover] getLayers error:', e.message);
      return err(res, 500, e.message);
    }
    if (!layers?.length) return ok(res, { ok: true, total: 0, added: 0, skipped: 0 });
    const existingResult = await db.execute({ sql: 'SELECT id, name_source FROM layers WHERE source_id = ?', args: [sid] });
    const existingMap = new Map(existingResult.rows.map(r => [r.name_source, r.id]));
    // getCount() omitido en discover — puede tardar minutos con fuentes grandes.
    // El feature_count se puede actualizar manualmente por capa desde el panel.
    const counts = {};
    let added = 0, skipped = 0;
    const ts = now();

    // Separar nuevas de existentes
    const toInsert = [];
    const toUpdate = [];

    for (const layer of layers) {
      const metadata = JSON.stringify({ ...(layer.metadata || {}), feature_count: null });
      const meta = layer.metadata || {};
      if (existingMap.has(layer.name)) {
        toUpdate.push({ sql: 'UPDATE layers SET metadata = ?, name_alias = COALESCE(name_alias, ?), discovered_at = ? WHERE id = ?', args: [metadata, layer.title || null, ts, existingMap.get(layer.name)] });
        skipped++;
      } else {
        toInsert.push({ sql: 'INSERT INTO layers (id, source_id, name_source, name_alias, geometry_type, srs, feature_count, included, metadata, discovered_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)', args: [id('lyr'), sid, layer.name, layer.title || null, (meta.geometry_type || 'UNKNOWN').toUpperCase(), meta.crs || 'EPSG:4326', null, metadata, ts] });
        added++;
      }
    }

    // Ejecutar en lotes de 50 para evitar timeout
    const allStmts = [...toInsert, ...toUpdate];
    const BATCH_SIZE = 50;
    for (let i = 0; i < allStmts.length; i += BATCH_SIZE) {
      try {
        await db.batch(allStmts.slice(i, i + BATCH_SIZE), 'write');
      } catch(e) {
        console.error('[discover] batch FAILED at', i, ':', e.message);
        // Fallback: ejecutar uno por uno
        for (const stmt of allStmts.slice(i, i + BATCH_SIZE)) {
          try { await db.execute(stmt); } catch(e2) { console.error('[discover] single execute failed:', e2.message); }
        }
      }
    }

    // ── Post-proceso: detectar geometrías DESPUÉS de los inserts ─────────
    // Se llama con timeout de 3s para no exceder el límite de Vercel (10s).
    // Si falla o se acaba el tiempo, las capas quedan con geometry_type = UNKNOWN.
    if (typeof entry.connector.getGeomTypes === 'function') {
      try {
        const geomTypes = await entry.connector.getGeomTypes(params, 3_000);
        const keys = Object.keys(geomTypes);
        if (keys.length > 0) {
          console.log('[discover] geometrías post-detect:', keys.length);
          await Promise.all(layers.map(layer => {
            const local = layer.name.includes(':') ? layer.name.split(':').pop() : layer.name;
            const geomType = geomTypes[local] || geomTypes[layer.name];
            if (!geomType) return Promise.resolve();
            return db.execute({
              sql:  'UPDATE layers SET geometry_type = ? WHERE source_id = ? AND name_source = ?',
              args: [geomType, sid, layer.name],
            });
          }));
        }
      } catch (e) {
        console.warn('[discover] getGeomTypes falló:', e.message);
      }
    }

    return ok(res, { ok: true, total: layers.length, added, skipped });
  }

  // ── GET/PATCH/DELETE por ID ──────────────────────────────────────────────
  if (sid) {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      const srcResult = await db.execute({ sql: 'SELECT * FROM sources WHERE id = ? LIMIT 1', args: [sid] });
      if (!srcResult.rows.length) return err(res, 404, 'Fuente no encontrada');
      const source = { ...srcResult.rows[0] };
      const cResult = await db.execute({ sql: 'SELECT country FROM source_countries WHERE source_id = ?', args: [sid] });
      source.countries = cResult.rows.map(r => r.country);
      // Conteos — el array de capas se carga por separado via GET /api/admin/layers?source_id=
      // para evitar que queries de 100+ filas cuelguen el handler en Vercel Hobby (timeout 10s).
      const cntResult = await db.execute({
        sql: 'SELECT COUNT(*) AS total, SUM(CASE WHEN included=1 THEN 1 ELSE 0 END) AS active FROM layers WHERE source_id = ?',
        args: [sid],
      });
      const cnt = cntResult.rows[0] || {};
      source.layers_total    = Number(cnt.total  || 0);
      source.layers_included = Number(cnt.active || 0);
      return ok(res, { source });
    }

    if (req.method === 'PATCH') {
      const body    = req.body || {};
      const updates = Object.entries(body).filter(([k]) => EDITABLE.includes(k)).reduce((a, [k, v]) => ({ ...a, [k]: v }), {});
      if (updates.connection_params && typeof updates.connection_params === 'object') updates.connection_params = JSON.stringify(updates.connection_params);
      const countries = Array.isArray(body.countries) ? body.countries : null;
      if (!Object.keys(updates).length && !countries) return err(res, 400, 'No hay campos válidos para actualizar');
      if (Object.keys(updates).length) {
        const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
        await db.execute({ sql: `UPDATE sources SET ${setClauses} WHERE id = ?`, args: [...Object.values(updates), sid] });
      }
      if (countries) {
        await db.execute({ sql: 'DELETE FROM source_countries WHERE source_id = ?', args: [sid] });
        for (const c of countries) await db.execute({ sql: 'INSERT OR IGNORE INTO source_countries (source_id, country) VALUES (?, ?)', args: [sid, c.toUpperCase()] });
      }
      const updated = await db.execute({ sql: 'SELECT * FROM sources WHERE id = ? LIMIT 1', args: [sid] });
      return ok(res, { source: updated.rows[0] });
    }

    if (req.method === 'DELETE') {
      const check = await db.execute({ sql: 'SELECT id FROM sources WHERE id = ? LIMIT 1', args: [sid] });
      if (!check.rows.length) return err(res, 404, 'Fuente no encontrada');
      await db.execute({ sql: 'DELETE FROM sources WHERE id = ?', args: [sid] });
      return ok(res, { ok: true, deleted: sid });
    }

    return err(res, 405, 'Method not allowed');
  }

  // ── INDEX (lista / crear) ────────────────────────────────────────────────
  if (req.method === 'GET') {
    const result = await db.execute(`SELECT s.id, s.name_source, s.name_alias, s.provider_source, s.provider_alias, s.data_format, s.access_method, s.included, s.status, s.last_checked, s.error_message, s.notes, s.created_at, COUNT(DISTINCT l.id) AS layers_total, COUNT(DISTINCT CASE WHEN l.included = 1 THEN l.id END) AS layers_included, COUNT(DISTINCT f.id) AS fields_total, COUNT(DISTINCT CASE WHEN f.included = 1 THEN f.id END) AS fields_included FROM sources s LEFT JOIN layers l ON l.source_id = s.id LEFT JOIN fields f ON f.source_id = s.id GROUP BY s.id ORDER BY s.created_at DESC`);
    const sourceIds = result.rows.map(r => r.id);
    const countriesBySource = {};
    if (sourceIds.length) {
      const cResult = await db.execute({ sql: `SELECT source_id, country FROM source_countries WHERE source_id IN (${sourceIds.map(() => '?').join(',')})`, args: sourceIds });
      for (const row of cResult.rows) (countriesBySource[row.source_id] = countriesBySource[row.source_id] || []).push(row.country);
    }
    const sources = result.rows.map(row => ({ ...row, countries: countriesBySource[row.id] || [], layers_total: row.layers_total || 0, layers_included: row.layers_included || 0, fields_total: row.fields_total || 0, fields_included: row.fields_included || 0 }));
    return ok(res, { sources });
  }

  if (req.method === 'POST') {
    const body    = req.body || {};
    const missing = requireFields(body, ['data_format']);
    if (missing) return err(res, 400, `Se requiere: ${missing}`);
    const connParams = typeof body.connection_params === 'object' ? JSON.stringify(body.connection_params) : (body.connection_params || '{}');
    const newId = id('src');
    const ts    = now();
    await db.execute({ sql: `INSERT INTO sources (id, name_source, name_alias, provider_source, provider_alias, data_format, access_method, connection_params, included, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unverified', ?, ?)`, args: [newId, body.name_source || null, body.name_alias || null, body.provider_source || null, body.provider_alias || null, body.data_format, body.access_method || 'url', connParams, body.included !== undefined ? (body.included ? 1 : 0) : 1, body.notes || null, ts] });
    const countries = Array.isArray(body.countries) ? body.countries : [];
    for (const country of countries) await db.execute({ sql: 'INSERT OR IGNORE INTO source_countries (source_id, country) VALUES (?, ?)', args: [newId, country.toUpperCase()] });
    const created = await db.execute({ sql: 'SELECT * FROM sources WHERE id = ? LIMIT 1', args: [newId] });
    return ok(res, { source: { ...created.rows[0], countries } }, 201);
  }

  return err(res, 405, 'Method not allowed');
};
