/**
 * api/_connectors/csv.js — Conector CSV
 *
 * Detección automática de columnas de geometría por nombre.
 * La "capa" en un CSV es el archivo completo.
 * getFeatureAtPoint hace point-in-polygon en memoria con los features del CSV.
 */

const { makeConnector } = require('./_interface');

const TIMEOUT_MS = 30_000;

// Nombres reconocidos de columnas de latitud/longitud
const LAT_NAMES = new Set(['lat', 'latitude', 'latitud', 'y', 'lat_y']);
const LON_NAMES = new Set(['lon', 'lng', 'longitude', 'longitud', 'x', 'lon_x']);

function fetchWithTimeout(url, ms = TIMEOUT_MS) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { signal: c.signal }).finally(() => clearTimeout(t));
}

/**
 * parseCsv(text, delimiter) → { headers, rows }
 *
 * Parser CSV mínimo — soporta delimitadores configurables y quoted fields.
 */
function parseCsv(text, delimiter = ',') {
  const lines   = text.trim().split('\n');
  const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''));

  const rows = lines.slice(1).map(line => {
    const values = [];
    let inQuote  = false;
    let current  = '';

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === delimiter && !inQuote) { values.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    values.push(current.trim());

    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? '']));
  });

  return { headers, rows };
}

/**
 * detectGeomColumns(headers) → { latCol, lonCol } | null
 */
function detectGeomColumns(headers) {
  const lower   = headers.map(h => h.toLowerCase());
  const latCol  = headers[lower.findIndex(h => LAT_NAMES.has(h))];
  const lonCol  = headers[lower.findIndex(h => LON_NAMES.has(h))];
  return latCol && lonCol ? { latCol, lonCol } : null;
}

/**
 * inferType(values) → tipo interno Capibara
 */
function inferType(values) {
  const sample = values.filter(v => v !== '' && v !== null);
  if (!sample.length) return 'unknown';
  if (sample.every(v => v === 'true' || v === 'false')) return 'boolean';
  if (sample.every(v => Number.isInteger(Number(v)) && !isNaN(Number(v)))) return 'integer';
  if (sample.every(v => !isNaN(Number(v)))) return 'float';
  return 'string';
}

module.exports = makeConnector({

  async connect(params) {
    const res = await fetchWithTimeout(params.url);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    const text    = await res.text();
    const { headers } = parseCsv(text, params.delimiter || ',');
    const geom    = detectGeomColumns(headers);

    return {
      ok:   true,
      info: {
        title:    null,
        abstract: null,
        provider: null,
        columns:  headers.length,
        has_geometry: !!geom,
      },
    };
  },

  async getLayers(params) {
    // Un CSV = una sola capa. El nombre es el path de la URL.
    const urlPath = new URL(params.url).pathname;
    const name    = urlPath.split('/').pop() || 'data';
    return [{
      name,
      title: null,
      metadata: { crs: params.crs || 'EPSG:4326', geometry_type: 'POINT', feature_count: null, abstract: null },
    }];
  },

  async getFields(params, _layerName) {
    const res     = await fetchWithTimeout(params.url);
    const text    = await res.text();
    const { headers, rows } = parseCsv(text, params.delimiter || ',');
    const sample  = rows.slice(0, 20);

    return headers.map(name => {
      const values  = sample.map(r => r[name]).filter(v => v !== '');
      const isLat   = LAT_NAMES.has(name.toLowerCase());
      const isLon   = LON_NAMES.has(name.toLowerCase());

      return {
        name,
        metadata: {
          type:         inferType(values),
          is_geometry:  isLat || isLon,
          has_html:     false,
          nullable:     values.length < sample.length,
          sample_value: values[0] || null,
        },
      };
    });
  },

  async getSample(params, _layerName, count = 5) {
    const res  = await fetchWithTimeout(params.url);
    const text = await res.text();
    const { rows } = parseCsv(text, params.delimiter || ',');
    return { features: rows.slice(0, count), total: rows.length };
  },

  async getFeatureAtPoint(params, _layerName, lat, lon) {
    try {
      const res  = await fetchWithTimeout(params.url);
      const text = await res.text();
      const { headers, rows } = parseCsv(text, params.delimiter || ',');
      const geom = detectGeomColumns(headers);

      if (!geom) return { feature: null, error: 'El CSV no tiene columnas de geometría detectables' };

      // Para CSVs de puntos: encontrar el punto más cercano dentro de ~500m
      const THRESHOLD = 0.005; // ~500m en grados
      let closest     = null;
      let minDist     = Infinity;

      for (const row of rows) {
        const rLat = parseFloat(row[geom.latCol]);
        const rLon = parseFloat(row[geom.lonCol]);
        if (isNaN(rLat) || isNaN(rLon)) continue;

        const dist = Math.sqrt((rLat - lat) ** 2 + (rLon - lon) ** 2);
        if (dist < minDist && dist < THRESHOLD) {
          minDist = dist;
          closest = row;
        }
      }

      return { feature: closest };
    } catch (e) {
      return { feature: null, error: e.message };
    }
  },
});
