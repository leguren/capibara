/**
 * api/_connectors/geojson.js — Conector GeoJSON
 *
 * Soporta FeatureCollection, Feature, y geometrías simples.
 * Siempre CRS EPSG:4326 (estándar GeoJSON, RFC 7946).
 * getFeatureAtPoint usa point-in-polygon con algoritmo ray-casting.
 */

const { makeConnector } = require('./_interface');

const TIMEOUT_MS = 30_000;

function fetchWithTimeout(url, ms = TIMEOUT_MS) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { signal: c.signal }).finally(() => clearTimeout(t));
}

/**
 * normalizeToFeatureCollection(data) → { features }
 *
 * Acepta FeatureCollection, Feature individual, o geometría simple
 * y normaliza a una estructura uniforme con array de features.
 */
function normalizeToFeatureCollection(data) {
  if (data.type === 'FeatureCollection') return data;
  if (data.type === 'Feature') return { features: [data] };
  // Geometría simple (Point, Polygon, etc.) — la envuelve como Feature
  return { features: [{ type: 'Feature', geometry: data, properties: {} }] };
}

/**
 * detectGeometryType(features) → string
 *
 * Detecta el tipo de geometría predominante en el array de features.
 */
function detectGeometryType(features) {
  if (!features?.length) return 'UNKNOWN';
  const geomType = features[0]?.geometry?.type;
  return geomType ? geomType.toUpperCase() : 'UNKNOWN';
}

/**
 * pointInPolygon(point, polygon) → boolean
 *
 * Algoritmo ray-casting para point-in-polygon.
 * point: [lon, lat]
 * polygon: array de rings GeoJSON [[lon, lat], ...]
 */
function pointInPolygon(point, polygon) {
  const [x, y] = point;
  const ring   = polygon[0];  // exterior ring
  let inside   = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = ((yi > y) !== (yj > y)) &&
                      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * featureContainsPoint(feature, lat, lon) → boolean
 */
function featureContainsPoint(feature, lat, lon) {
  const geom = feature.geometry;
  if (!geom) return false;
  const pt = [lon, lat];

  if (geom.type === 'Point') {
    const THRESHOLD = 0.0005;
    return Math.abs(geom.coordinates[0] - lon) < THRESHOLD &&
           Math.abs(geom.coordinates[1] - lat) < THRESHOLD;
  }
  if (geom.type === 'Polygon') return pointInPolygon(pt, geom.coordinates);
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.some(poly => pointInPolygon(pt, poly));
  }
  return false;
}

module.exports = makeConnector({

  async connect(params) {
    const res = await fetchWithTimeout(params.url);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    const data = await res.json();
    const { features } = normalizeToFeatureCollection(data);
    if (!features) return { ok: false, error: 'No se encontraron features en el GeoJSON' };

    return {
      ok:   true,
      info: { title: null, abstract: null, provider: null, feature_count: features.length },
    };
  },

  async getLayers(params) {
    const urlPath = new URL(params.url).pathname;
    const name    = urlPath.split('/').pop()?.replace(/\.geojson$/i, '') || 'data';
    return [{
      name,
      title: null,
      metadata: {
        crs:           'EPSG:4326',
        geometry_type: 'UNKNOWN',
        feature_count: null,
        abstract:      null,
      },
    }];
  },

  async getFields(params, _layerName) {
    const res  = await fetchWithTimeout(params.url);
    const data = await res.json();
    const { features } = normalizeToFeatureCollection(data);

    // Recolectar todos los campos únicos de las primeras 20 features
    const fieldMap = new Map();
    for (const f of features.slice(0, 20)) {
      for (const [k, v] of Object.entries(f.properties || {})) {
        if (!fieldMap.has(k)) {
          fieldMap.set(k, { name: k, sample: v });
        }
      }
    }

    return Array.from(fieldMap.values()).map(({ name, sample }) => ({
      name,
      metadata: {
        type:         typeof sample === 'number'
                        ? (Number.isInteger(sample) ? 'integer' : 'float')
                        : typeof sample === 'boolean' ? 'boolean' : 'string',
        is_geometry:  false,
        has_html:     typeof sample === 'string' && /<[a-z]/i.test(sample),
        nullable:     true,
        sample_value: sample !== null && sample !== undefined ? String(sample) : null,
      },
    }));
  },

  async getSample(params, _layerName, count = 5) {
    const res  = await fetchWithTimeout(params.url);
    const data = await res.json();
    const { features } = normalizeToFeatureCollection(data);
    return {
      features: features.slice(0, count).map(f => f.properties),
      total:    features.length,
    };
  },

  async getFeatureAtPoint(params, _layerName, lat, lon) {
    try {
      const res  = await fetchWithTimeout(params.url);
      const data = await res.json();
      const { features } = normalizeToFeatureCollection(data);

      const match = features.find(f => featureContainsPoint(f, lat, lon));
      return { feature: match?.properties || null };
    } catch (e) {
      return { feature: null, error: e.message };
    }
  },
});
