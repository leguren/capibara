/**
 * api/geo/catalog.js — Catálogo de metadatos consolidado
 *
 * Rutas (via vercel.json rewrites):
 *   GET /api/geo/1/catalog              → index
 *   GET /api/geo/1/catalog/domains      → ?sub=domains
 *   GET /api/geo/1/catalog/layers       → ?sub=layers
 *   GET /api/geo/1/catalog/coverage     → ?sub=coverage
 */

const { getDb }  = require('../_turso');
const { initSchema, getLatestPublication } = require('../_db');

const DOMAIN_LABELS = {
  geo: 'Geografía', normative: 'Normativa', cadastre: 'Catastro',
  social: 'Social', demographics: 'Demografía', electoral: 'Electoral',
  environment: 'Medio ambiente', climate: 'Clima', biological_risk: 'Riesgo biológico',
  defense: 'Defensa', security: 'Seguridad', infrastructure: 'Infraestructura',
  transport: 'Transporte', energy: 'Energía', fire_risk: 'Riesgo de incendio',
  geodynamic_risk: 'Riesgo geodinámico', water_risk: 'Riesgo hídrico',
  weather_risk: 'Riesgo meteorológico', technological_risk: 'Riesgo tecnológico',
  monitoring: 'Monitoreo',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')  return res.status(405).json({ error: 'Method not allowed' });

  await initSchema();
  const pub = await getLatestPublication(getDb());
  if (!pub) return res.status(503).json({ error: 'No hay datos publicados aún' });

  const sub = req.query.sub;
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');

  // ── COVERAGE ─────────────────────────────────────────────────────────────
  if (sub === 'coverage') {
    const lat = parseFloat(req.query.lat);
    const lon = parseFloat(req.query.lon);
    if (isNaN(lat) || isNaN(lon)) return res.status(400).json({ error: 'Se requieren lat y lon válidos' });
    const byDomain = {};
    let totalLayers = 0;
    for (const s of pub.config.sources) {
      for (const l of s.layers) {
        const bbox = l.bbox;
        if (bbox.min_lat !== null) { if (lat < bbox.min_lat || lat > bbox.max_lat) continue; if (lon < bbox.min_lon || lon > bbox.max_lon) continue; }
        const d = l.domain || 'uncategorized';
        if (!byDomain[d]) byDomain[d] = [];
        byDomain[d].push({ source_id: s.id, source_name: s.name_alias || s.name_source, layer_id: l.id, layer_name: l.name_alias || l.name_source, domain: l.domain, update_frequency: l.update_frequency, geometry_type: l.geometry_type, fields_count: (l.fields || []).length });
        totalLayers++;
      }
    }
    return res.status(200).json({ lat, lon, version: pub.version_label, total_layers: totalLayers, domains_covered: Object.keys(byDomain).length, coverage: byDomain });
  }

  // ── DOMAINS ──────────────────────────────────────────────────────────────
  if (sub === 'domains') {
    const stats = {};
    for (const s of pub.config.sources) {
      for (const l of s.layers) {
        const d = l.domain || 'uncategorized';
        if (!stats[d]) stats[d] = { layers: 0, sources: new Set() };
        stats[d].layers++;
        stats[d].sources.add(s.id);
      }
    }
    const domains = Object.entries(stats).map(([domId, v]) => ({ id: domId, label: DOMAIN_LABELS[domId] || domId, layers_count: v.layers, sources_count: v.sources.size })).sort((a, b) => b.layers_count - a.layers_count);
    return res.status(200).json({ version: pub.version_label, domains });
  }

  // ── LAYERS ───────────────────────────────────────────────────────────────
  if (sub === 'layers') {
    const domains = req.query.domain ? req.query.domain.split(',').map(d => d.trim()) : null;
    const layers  = [];
    for (const s of pub.config.sources) {
      for (const l of s.layers) {
        if (domains && l.domain && !domains.includes(l.domain)) continue;
        layers.push({ id: l.id, name: l.name_alias || l.name_source, domain: l.domain, update_frequency: l.update_frequency, geometry_type: l.geometry_type, fields_count: (l.fields || []).length, bbox: l.bbox, source: s.name_alias || s.name_source });
      }
    }
    return res.status(200).json({ version: pub.version_label, total: layers.length, layers });
  }

  // ── INDEX ─────────────────────────────────────────────────────────────────
  const domainStats = {};
  let totalLayers = 0;
  for (const s of pub.config.sources) {
    for (const l of s.layers) {
      const d = l.domain || 'uncategorized';
      if (!domainStats[d]) domainStats[d] = { layers: 0, sources: new Set() };
      domainStats[d].layers++;
      domainStats[d].sources.add(s.id);
      totalLayers++;
    }
  }
  const domains = Object.entries(domainStats).map(([name, stats]) => ({ domain: name, layers_count: stats.layers, sources_count: stats.sources.size })).sort((a, b) => b.layers_count - a.layers_count);
  return res.status(200).json({
    version: pub.version_label, published_at: pub.created_at,
    sources_count: pub.config.sources.length, layers_count: totalLayers, domains,
    endpoints: { query: '/api/geo/1/query?lat={lat}&lon={lon}', catalog: '/api/geo/1/catalog', domains: '/api/geo/1/catalog/domains', layers: '/api/geo/1/catalog/layers?domain={domain}', coverage: '/api/geo/1/catalog/coverage?lat={lat}&lon={lon}' },
  });
};
