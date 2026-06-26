/**
 * api/_connectors/json.js — Conector JSON genérico
 *
 * Soporta múltiples formatos de JSON que no son GeoJSON:
 *   - Google Sheets API: { range, majorDimension, values }
 *   - Array de arrays: [[col1, col2], [val1, val2]]
 *   - Array de objetos: [{ campo: valor }, ...]
 *   - Objeto con array interno: { data: [...] }, { items: [...] }, etc.
 *
 * Limpieza de HTML: muchas fuentes JSON (especialmente Google Sheets
 * con celdas ricas) devuelven valores con tags <span>, <b>, etc.
 * El conector los limpia automáticamente.
 *
 * Google Sheets: la fila 0 puede ser nombres internos y la fila 1
 * etiquetas legibles. El conector detecta esto comparando con los datos.
 */

const { makeConnector } = require('./_interface');

const TIMEOUT_MS = 30_000;

// Claves conocidas que contienen el array de datos en objetos wrapper
const ARRAY_KEYS = ['data', 'items', 'features', 'results', 'records', 'rows', 'values'];

function fetchWithTimeout(url, ms = TIMEOUT_MS) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { signal: c.signal }).finally(() => clearTimeout(t));
}

/**
 * stripHtml(str) → string
 */
function stripHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

/**
 * normalizeToRows(data) → { headers, rows, labels? }
 *
 * Normaliza cualquier formato JSON soportado a { headers, rows }.
 * labels → segunda fila de headers legibles si existe (Google Sheets).
 */
function normalizeToRows(data) {
  // Google Sheets: { majorDimension: 'ROWS', values: [[...]] }
  if (data?.majorDimension === 'ROWS' && Array.isArray(data.values)) {
    const [headerRow, maybeLabels, ...rest] = data.values;
    const headers = headerRow;

    // Detectar si la segunda fila son labels (no parecen datos normales)
    const hasLabels = maybeLabels && rest.length > 0 &&
      maybeLabels.some((v, i) => typeof v === 'string' && typeof rest[0]?.[i] !== typeof v);

    const dataRows = hasLabels ? rest : [maybeLabels, ...rest].filter(Boolean);
    const labels   = hasLabels ? maybeLabels : null;

    return {
      headers,
      labels,
      rows: dataRows.map(row => Object.fromEntries(headers.map((h, i) => [h, stripHtml(row[i] ?? '')]))),
    };
  }

  // Array de arrays: [[col1, col2], [val1, val2], ...]
  if (Array.isArray(data) && Array.isArray(data[0])) {
    const [headerRow, ...dataRows] = data;
    return {
      headers: headerRow,
      rows:    dataRows.map(row => Object.fromEntries(headerRow.map((h, i) => [h, stripHtml(row[i] ?? '')]))),
    };
  }

  // Array de objetos
  if (Array.isArray(data) && typeof data[0] === 'object') {
    const headers = Object.keys(data[0] || {});
    return {
      headers,
      rows: data.map(obj => Object.fromEntries(headers.map(h => [h, stripHtml(obj[h])]))),
    };
  }

  // Objeto con array interno
  if (typeof data === 'object' && data !== null) {
    for (const key of ARRAY_KEYS) {
      if (Array.isArray(data[key]) && data[key].length > 0) {
        const inner = data[key];
        if (Array.isArray(inner[0])) {
          const [headerRow, ...dataRows] = inner;
          return {
            headers: headerRow,
            rows:    dataRows.map(row => Object.fromEntries(headerRow.map((h, i) => [h, stripHtml(row[i] ?? '')]))),
          };
        }
        if (typeof inner[0] === 'object') {
          const headers = Object.keys(inner[0]);
          return {
            headers,
            rows: inner.map(obj => Object.fromEntries(headers.map(h => [h, stripHtml(obj[h])]))),
          };
        }
      }
    }
  }

  throw new Error('Formato JSON no reconocido. Formatos soportados: Google Sheets API, array de arrays, array de objetos, objeto con array interno');
}

module.exports = makeConnector({

  async connect(params) {
    const res = await fetchWithTimeout(params.url);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    const data = await res.json();
    try {
      const { headers, rows } = normalizeToRows(data);
      return {
        ok:   true,
        info: { title: null, abstract: null, provider: null, columns: headers.length, rows: rows.length },
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  async getLayers(params) {
    const urlPath = new URL(params.url).pathname;
    const name    = urlPath.split('/').pop() || 'data';
    return [{
      name,
      title: null,
      metadata: { crs: null, geometry_type: 'NONE', feature_count: null, abstract: null },
    }];
  },

  async getFields(params, _layerName) {
    const res  = await fetchWithTimeout(params.url);
    const data = await res.json();
    const { headers, labels, rows } = normalizeToRows(data);
    const sample = rows.slice(0, 10);

    return headers.map((name, i) => {
      const values  = sample.map(r => r[name]).filter(v => v !== '' && v !== undefined);
      const first   = values[0];
      const hasHtml = values.some(v => typeof v === 'string' && /<[a-z]/i.test(v));

      return {
        name,
        metadata: {
          type:         typeof first === 'number'
                          ? (Number.isInteger(first) ? 'integer' : 'float')
                          : 'string',
          label:        labels?.[i] || null,  // etiqueta legible de Google Sheets
          is_geometry:  false,
          has_html:     hasHtml,
          nullable:     values.length < sample.length,
          sample_value: first !== undefined ? String(first) : null,
        },
      };
    });
  },

  async getSample(params, _layerName, count = 5) {
    const res  = await fetchWithTimeout(params.url);
    const data = await res.json();
    const { rows } = normalizeToRows(data);
    return { features: rows.slice(0, count), total: rows.length };
  },

  // JSON genérico no tiene geometría propia — no puede hacer point-in-polygon.
  // Se puede usar si tiene columnas lat/lon, pero eso cae en el conector CSV.
  async getFeatureAtPoint(_params, _layerName, _lat, _lon) {
    return { feature: null, error: 'El conector JSON no soporta consulta por coordenada. Usar conector CSV si el JSON tiene columnas de latitud/longitud.' };
  },
});
