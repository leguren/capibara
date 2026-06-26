/**
 * api/_connectors/arcgis.js — Conector ArcGIS REST
 *
 * Implementa la interfaz para servicios ArcGIS REST FeatureServer y MapServer.
 *
 * Operaciones:
 *   connect          → /?f=json al endpoint base
 *   getLayers        → /?f=json devuelve layers[] con id y name
 *   getFields        → /{layerId}?f=json devuelve fields[]
 *   getSample        → /{layerId}/query?where=1=1&resultRecordCount=N&f=geojson
 *   getFeatureAtPoint → /{layerId}/query con geometría de punto
 *
 * Notas:
 *   - El name_source de cada capa es el id numérico del layer (ej: '0', '1')
 *     porque así se referencia en los requests subsiguientes
 *   - Soporta autenticación por token en connection_params.auth_value
 *   - ArcGIS REST usa alias (label legible) para los nombres de campos
 */

const { makeConnector } = require('./_interface');

const TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function fetchWithTimeout(url, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

/**
 * addAuth(url, authValue) → string
 *
 * Agrega el token de autenticación si existe.
 */
function addAuth(url, authValue) {
  if (!authValue) return url;
  const u = new URL(url);
  u.searchParams.set('token', authValue);
  return u.toString();
}

/**
 * mapArcGisType(esriType) → tipo interno Capibara
 */
function mapArcGisType(esriType) {
  const map = {
    'esriFieldTypeString':   'string',
    'esriFieldTypeInteger':  'integer',
    'esriFieldTypeSmallInteger': 'integer',
    'esriFieldTypeDouble':   'float',
    'esriFieldTypeSingle':   'float',
    'esriFieldTypeDate':     'string',  // fecha como string ISO
    'esriFieldTypeOID':      'integer',
    'esriFieldTypeGeometry': 'geometry',
    'esriFieldTypeBlob':     'unknown',
    'esriFieldTypeGUID':     'string',
  };
  return map[esriType] || 'unknown';
}

// ---------------------------------------------------------------------------
// Implementación del conector
// ---------------------------------------------------------------------------

module.exports = makeConnector({

  async connect(params) {
    const url = addAuth(`${params.url}?f=json`, params.auth_value);
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    const data = await res.json();
    if (data.error) return { ok: false, error: data.error.message || 'Error del servicio ArcGIS' };
    if (!data.serviceDescription && !data.layers && !data.name) {
      return { ok: false, error: 'La URL no parece ser un FeatureServer o MapServer válido' };
    }

    return {
      ok:   true,
      info: {
        title:    data.serviceDescription || data.name || null,
        abstract: data.description || null,
        provider: null,  // ArcGIS REST no expone el proveedor directamente
      },
    };
  },

  async getLayers(params) {
    const url  = addAuth(`${params.url}?f=json`, params.auth_value);
    const res  = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (!data.layers?.length) throw new Error('El servicio no tiene capas disponibles');

    return data.layers.map(layer => ({
      name:  String(layer.id),  // El ID numérico es el identificador para requests futuros
      title: layer.name || null,
      metadata: {
        crs:           'EPSG:4326',   // ArcGIS REST siempre devuelve en 4326 con ?f=geojson
        geometry_type: layer.geometryType?.replace('esriGeometry', '').toUpperCase() || 'UNKNOWN',
        feature_count: layer.count || null,
        abstract:      layer.description || null,
      },
    }));
  },

  async getFields(params, layerName) {
    const url = addAuth(`${params.url}/${layerName}?f=json`, params.auth_value);
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (!data.fields?.length) throw new Error('La capa no tiene campos definidos');

    return data.fields.map(field => ({
      name: field.name,
      metadata: {
        type:         mapArcGisType(field.type),
        label:        field.alias || null,  // ArcGIS provee alias — candidato a name_alias
        is_geometry:  field.type === 'esriFieldTypeGeometry',
        has_html:     false,
        nullable:     true,
        sample_value: null,
      },
    }));
  },

  async getSample(params, layerName, count = 5) {
    const baseUrl = addAuth(
      `${params.url}/${layerName}/query?where=1%3D1&outFields=*&resultRecordCount=${count}&f=geojson`,
      params.auth_value
    );

    const res  = await fetchWithTimeout(baseUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    return {
      features: data.features || [],
      total:    data.features?.length || 0,
    };
  },

  async getFeatureAtPoint(params, layerName, lat, lon) {
    const geom    = JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } });
    const baseUrl = addAuth(
      `${params.url}/${layerName}/query?geometry=${encodeURIComponent(geom)}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=*&f=geojson`,
      params.auth_value
    );

    try {
      const res  = await fetchWithTimeout(baseUrl);
      if (!res.ok) return { feature: null, error: `HTTP ${res.status}` };

      const data    = await res.json();
      const feature = data.features?.[0]?.properties || null;
      return { feature };
    } catch (e) {
      return { feature: null, error: e.message };
    }
  },
});
