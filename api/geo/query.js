/**
 * api/geo/query.js — Endpoint central del producto
 *
 * GET /api/geo/1/query?lat=&lon= (rewritten from vercel.json)
 * Autenticación: API key via Authorization: Bearer
 */

const { getDb }          = require('../_turso');
const { initSchema, getLatestPublication, logUsage } = require('../_db');
const { requireApiKey, verifySession } = require('../_auth');
const { getConnector }   = require('../_connectors/_registry');
const { safeJson }       = require('../_utils');

const CACHE_TTL = {
  not_planned: 90*24*3600, annually: 30*24*3600, biannually: 14*24*3600,
  quarterly: 7*24*3600, monthly: 24*3600, fortnightly: 24*3600,
  weekly: 3600, daily: 3600, irregular: 6*3600, as_needed: 6*3600,
  unknown: 6*3600, continual: 0,
};

function resolveLoadOrder(layers) {
  const layerMap = new Map(layers.map(l => [l.id, l]));
  const visited  = new Set();
  const result   = [];
  function visit(layer, chain = new Set()) {
    if (chain.has(layer.id) || visited.has(layer.id)) return;
    chain.add(layer.id);
    for (const dep of (layer.dependencies || [])) { const parent = layerMap.get(dep.depends_on_id); if (parent) visit(parent, new Set(chain)); }
    visited.add(layer.id);
    result.push(layer);
  }
  for (const layer of layers) visit(layer);
  return result;
}

function applyFieldAliases(feature, fields) {
  if (!feature) return null;
  const result = {};
  for (const field of fields) {
    const value = feature[field.name_source];
    if (value === undefined) continue;
    result[field.name_alias || field.name_source] = value;
  }
  return result;
}

// ── executeGeoQuery ─────────────────────────────────────────────────────
// Lógica central compartida por los tres handlers: query, demo y preview.
// layersFromPub: capas ya filtradas por bbox/dominio desde pub.config
// userId: null para demo (sin prefs de usuario), string para query/preview
async function executeGeoQuery(lat, lon, layersFromPub, userId, db) {
  const excludedLayers = new Set();
  const excludedFields = new Set();

  if (userId && layersFromPub.length) {
    const layerIds = layersFromPub.map(l => l.id);
    const fieldIds = layersFromPub.flatMap(l => l.fields.map(f => f.id));
    const [lp, fp] = await Promise.all([
      layerIds.length ? db.execute({ sql: `SELECT layer_id, included FROM user_layer_prefs WHERE user_id = ? AND layer_id IN (${layerIds.map(()=>'?').join(',')})`, args: [userId,...layerIds] }) : Promise.resolve({ rows: [] }),
      fieldIds.length ? db.execute({ sql: `SELECT field_id, included FROM user_field_prefs WHERE user_id = ? AND field_id IN (${fieldIds.map(()=>'?').join(',')})`, args: [userId,...fieldIds] }) : Promise.resolve({ rows: [] }),
    ]);
    lp.rows.filter(r => !r.included).forEach(r => excludedLayers.add(r.layer_id));
    fp.rows.filter(r => !r.included).forEach(r => excludedFields.add(r.field_id));
  }

  const activeLayers = layersFromPub.filter(l => !excludedLayers.has(l.id));
  const sorted       = resolveLoadOrder(activeLayers);
  const data = [], errors = [], resolvedBy = {};
  let minTtl = CACHE_TTL.not_planned;

  const bySource = new Map();
  for (const layer of sorted) {
    if (!bySource.has(layer.source.id)) bySource.set(layer.source.id, { source: layer.source, layers: [] });
    bySource.get(layer.source.id).layers.push(layer);
  }

  await Promise.allSettled(Array.from(bySource.values()).map(async ({ source, layers }) => {
    const entry = getConnector(source.data_format);
    if (!entry?.implemented) return;
    for (const layer of layers) {
      const layerTtl = CACHE_TTL[layer.update_frequency] ?? CACHE_TTL.unknown;
      if (layerTtl < minTtl) minTtl = layerTtl;
      let extra = {};
      for (const dep of (layer.dependencies || [])) {
        const p = resolvedBy[dep.depends_on_id];
        if (p?.[dep.input_field] !== undefined) extra[dep.output_param] = p[dep.input_field];
      }
      try {
        const { feature, error } = await entry.connector.getFeatureAtPoint({ ...source.connection_params, ...extra }, layer.name_source, lat, lon);
        if (error) { errors.push({ layer_id: layer.id, layer_name: layer.name_alias || layer.name_source, error }); return; }
        if (feature) resolvedBy[layer.id] = feature;
        const visibleFields  = (layer.fields || []).filter(f => !excludedFields.has(f.id));
        const aliasedFeature = applyFieldAliases(feature, visibleFields);
        data.push({ source_id: source.id, source_name: source.name_alias || source.name_source || source.id, layer_id: layer.id, layer_name: layer.name_alias || layer.name_source, domain: layer.domain, feature: aliasedFeature });
      } catch (e) {
        errors.push({ layer_id: layer.id, layer_name: layer.name_alias || layer.name_source, error: e.message });
      }
    }
  }));

  return { data, errors, minTtl };
}

// ── Handler DEMO ─────────────────────────────────────────────────────────
// Público, sin autenticación. Devuelve datos reales pero limitados.
//
// TODO: elegir qué capas específicas mostrar en el demo.
// Por ahora tomamos las primeras N capas disponibles en el bbox.
// En producción, definir una lista curada de capas representativas
// que no contengan datos sensibles y sean visualmente interesantes.
// Opciones: capas de división política (provincia, municipio),
// cobertura de suelo, o cualquier capa temática que muestre el valor
// del producto sin exponer datos privados.
const DEMO_MAX_LAYERS = 3;

async function handleDemo(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const rawLat = parseFloat(req.query.lat);
  const rawLon = parseFloat(req.query.lon);
  if (isNaN(rawLat) || isNaN(rawLon)) return res.status(400).json({ error: 'Se requieren lat y lon válidos' });
  if (rawLat < -90 || rawLat > 90 || rawLon < -180 || rawLon > 180) return res.status(400).json({ error: 'Coordenadas fuera de rango' });

  const lat = Math.round(rawLat * 1000) / 1000;
  const lon = Math.round(rawLon * 1000) / 1000;

  const db  = getDb();
  const pub = await getLatestPublication(db);
  if (!pub) return res.status(503).json({ error: 'No hay datos publicados aún' });

  const allLayers = [];
  for (const source of pub.config.sources) {
    for (const layer of source.layers) {
      const bbox = layer.bbox;
      if (bbox.min_lat !== null) {
        if (lat < bbox.min_lat || lat > bbox.max_lat) continue;
        if (lon < bbox.min_lon || lon > bbox.max_lon) continue;
      }
      allLayers.push({ ...layer, source });
      if (allLayers.length >= DEMO_MAX_LAYERS) break;
    }
    if (allLayers.length >= DEMO_MAX_LAYERS) break;
  }

  const { data, errors, minTtl } = await executeGeoQuery(lat, lon, allLayers, null, db);

  if (minTtl > 0) res.setHeader('Cache-Control', `public, s-maxage=${minTtl}, stale-while-revalidate=${minTtl * 2}`);
  return res.status(200).json({ lat, lon, queried_at: new Date().toISOString(), demo: true, data, errors: errors.length ? errors : undefined });
}

// ── Handler PREVIEW ──────────────────────────────────────────────────────
// Autenticado por sesión (cookie), sin API key.
// Acceso completo — mismo resultado que el query principal.
// No loggea uso en api_usage (es una consulta de preview, no producción).
async function handlePreview(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const session = verifySession(req);
  if (!session) return res.status(401).json({ error: 'Sesión requerida para el preview' });

  const rawLat = parseFloat(req.query.lat);
  const rawLon = parseFloat(req.query.lon);
  if (isNaN(rawLat) || isNaN(rawLon)) return res.status(400).json({ error: 'Se requieren lat y lon válidos' });
  if (rawLat < -90 || rawLat > 90 || rawLon < -180 || rawLon > 180) return res.status(400).json({ error: 'Coordenadas fuera de rango' });

  const lat = Math.round(rawLat * 1000) / 1000;
  const lon = Math.round(rawLon * 1000) / 1000;
  const domains = req.query.domain ? req.query.domain.split(',').map(d => d.trim()) : null;

  const db  = getDb();
  const pub = await getLatestPublication(db);
  if (!pub) return res.status(503).json({ error: 'No hay datos publicados aún' });

  const allLayers = [];
  for (const source of pub.config.sources) {
    for (const layer of source.layers) {
      const bbox = layer.bbox;
      if (bbox.min_lat !== null) {
        if (lat < bbox.min_lat || lat > bbox.max_lat) continue;
        if (lon < bbox.min_lon || lon > bbox.max_lon) continue;
      }
      if (domains && layer.domain && !domains.includes(layer.domain)) continue;
      allLayers.push({ ...layer, source });
    }
  }

  const { data, errors, minTtl } = await executeGeoQuery(lat, lon, allLayers, session.userId, db);
  if (minTtl > 0) res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json({ lat, lon, queried_at: new Date().toISOString(), data, errors: errors.length ? errors : undefined });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  await initSchema();

  const sub = req.query.sub;
  if (sub === 'demo')    return handleDemo(req, res);
  if (sub === 'preview') return handlePreview(req, res);


  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const startMs = Date.now();
  await initSchema();
  const keyInfo = await requireApiKey(req, res);
  if (!keyInfo) return;

  const rawLat   = parseFloat(req.query.lat);
  const rawLon   = parseFloat(req.query.lon);
  const precision = Math.min(Math.max(parseInt(req.query.precision || '3', 10), 1), 8);
  const domains  = req.query.domain ? req.query.domain.split(',').map(d => d.trim()) : null;

  if (isNaN(rawLat) || isNaN(rawLon)) return res.status(400).json({ error: 'Se requieren lat y lon válidos' });
  if (rawLat < -90 || rawLat > 90 || rawLon < -180 || rawLon > 180) return res.status(400).json({ error: 'Coordenadas fuera de rango' });

  const factor = Math.pow(10, precision);
  const lat    = Math.round(rawLat * factor) / factor;
  const lon    = Math.round(rawLon * factor) / factor;

  const db = getDb();
  const pub = await getLatestPublication(db);
  if (!pub) return res.status(503).json({ error: 'No hay datos publicados aún' });

  const allLayers = [];
  for (const source of pub.config.sources) {
    for (const layer of source.layers) {
      const bbox = layer.bbox;
      if (bbox.min_lat !== null) {
        if (lat < bbox.min_lat || lat > bbox.max_lat) continue;
        if (lon < bbox.min_lon || lon > bbox.max_lon) continue;
      }
      if (domains && layer.domain && !domains.includes(layer.domain)) continue;
      allLayers.push({ ...layer, source });
    }
  }

  if (!allLayers.length) {
    logUsage({ keyId: keyInfo.keyId, endpoint: '/api/geo/1/query', lat, lon, statusCode: 200, responseMs: Date.now() - startMs });
    return res.status(200).json({ lat, lon, queried_at: new Date().toISOString(), cache_ttl: CACHE_TTL.not_planned, data: [], errors: [] });
  }

  const { data, errors, minTtl } = await executeGeoQuery(lat, lon, allLayers, keyInfo.userId, db);

  if (minTtl > 0) res.setHeader('Cache-Control', `public, s-maxage=${minTtl}, stale-while-revalidate=${minTtl * 2}`);
  else res.setHeader('Cache-Control', 'no-store');

  const responseMs = Date.now() - startMs;
  logUsage({ keyId: keyInfo.keyId, endpoint: '/api/geo/1/query', lat, lon, statusCode: 200, responseMs });
  return res.status(200).json({ lat, lon, queried_at: new Date().toISOString(), cache_ttl: minTtl, response_ms: responseMs, data, errors: errors.length ? errors : undefined });
};
