/**
 * api/_connectors/_registry.js — Registro central de conectores
 *
 * ÚNICA fuente de verdad para qué conectores existen en Capibara.
 * Importado por: detect.js, sources/connect.js, sources/discover.js,
 *                layers/discover.js, fields/sample.js, geo/1/query.js
 *
 * Para agregar un nuevo conector:
 *   1. Crear api/_connectors/{tipo}.js implementando la interfaz
 *   2. Agregar una entrada acá con implemented: true
 *   3. Listo — el sistema lo detecta y lo usa automáticamente
 *
 * implemented: false → el conector está registrado (aparece en el panel)
 *                      pero no está completo. El sistema advierte al usuario.
 */

const wfs     = require('./wfs');
const arcgis  = require('./arcgis');
const csv     = require('./csv');
const geojson = require('./geojson');
const json    = require('./json');

const REGISTRY = {
  wfs: {
    label:       'WFS (OGC Web Feature Service)',
    implemented: true,
    connector:   wfs,
  },
  arcgis_rest: {
    label:       'ArcGIS REST',
    implemented: true,
    connector:   arcgis,
  },
  csv: {
    label:       'CSV',
    implemented: true,
    connector:   csv,
  },
  geojson: {
    label:       'GeoJSON',
    implemented: true,
    connector:   geojson,
  },
  json: {
    label:       'JSON (Google Sheets, arrays, etc.)',
    implemented: true,
    connector:   json,
  },
  xlsx: {
    label:       'Excel (XLSX)',
    implemented: false,
    connector:   null,
  },
  rss: {
    label:       'RSS / Atom',
    implemented: false,
    connector:   null,
  },
  // network: implementación futura — requiere infraestructura de routing
  // (pgRouting / OSRM). Documentado aquí para no olvidarlo.
  // network: {
  //   label:       'Network (routing)',
  //   implemented: false,
  //   connector:   null,
  // },
};

/**
 * getConnector(format) → { label, implemented, connector } | null
 */
function getConnector(format) {
  return REGISTRY[format] || null;
}

/**
 * listFormats() → [{ format, label, implemented }]
 *
 * Lista todos los formatos registrados para el formulario de nueva fuente
 * y para el endpoint de detección.
 */
function listFormats() {
  return Object.entries(REGISTRY).map(([format, entry]) => ({
    format,
    label:       entry.label,
    implemented: entry.implemented,
  }));
}

module.exports = { getConnector, listFormats, REGISTRY };
