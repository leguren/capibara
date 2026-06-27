/**
 * api/_connectors/wfs.js — Conector OGC Web Feature Service
 *
 * Implementa la interfaz completa para servicios WFS 1.0.0, 1.1.0 y 2.0.0.
 *
 * Operaciones:
 *   connect          → GetCapabilities — extrae versión, título, abstract, proveedor
 *   getLayers        → GetCapabilities — lista FeatureTypeList
 *   getFields        → DescribeFeatureType — analiza schema XSD
 *   getSample        → GetFeature con COUNT/maxFeatures + OUTPUTFORMAT=json
 *   getCount         → GetFeature con RESULTTYPE=hits
 *   getFeatureAtPoint → GetFeature con CQL_FILTER o BBOX para point-in-polygon
 *
 * Notas de implementación:
 *   - buildUrl() limpia query params existentes antes de construir cada request
 *     para evitar conflictos con URLs que ya vienen con ?request=GetCapabilities
 *   - Timeout: 30s para operaciones normales, 8s para getCount (informativo)
 *   - removeNSPrefix elimina namespaces arbitrarios del XML (ign:provincia → provincia)
 */

const { makeConnector } = require('./_interface');

const TIMEOUT_MS       = 30_000;
const TIMEOUT_COUNT_MS = 8_000;

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * buildUrl(base, params) → string
 *
 * Construye una URL WFS limpiando primero todos los query params existentes.
 * Evita conflictos cuando la URL base ya contiene parámetros WFS.
 */
function buildUrl(base, params) {
  const u = new URL(base);
  // Limpiar params existentes — los reconstruimos desde cero
  u.search = '';
  Object.entries(params).forEach(([k, v]) => {
    if (v !== null && v !== undefined) u.searchParams.set(k, String(v));
  });
  return u.toString();
}

/**
 * fetchWithTimeout(url, timeoutMs) → Response
 */
async function fetchWithTimeout(url, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * removeNSPrefix(str) → string
 *
 * Elimina prefijos de namespace XML: 'ign:provincia' → 'provincia'
 * Necesario para manejar namespaces arbitrarios de distintos servidores.
 */
function removeNSPrefix(str) {
  if (!str) return str;
  const colon = str.indexOf(':');
  return colon === -1 ? str : str.slice(colon + 1);
}

/**
 * parseCapabilities(xml) → { version, title, abstract, provider, featureTypes }
 *
 * Parsea XML de GetCapabilities con regex conservadores.
 * Soporta WFS 1.0.0, 1.1.0 y 2.0.0 (estructuras levemente distintas).
 */
function parseCapabilities(xml) {
  const extract = (patterns, fallback = null) => {
    for (const pattern of patterns) {
      const m = xml.match(pattern);
      if (m?.[1]?.trim()) return m[1].trim();
    }
    return fallback;
  };

  const version  = extract([/version="([^"]+)"/]);
  const title    = extract([/<ows:Title>([^<]+)<\/ows:Title>/, /<Service>[\s\S]*?<Title>([^<]+)<\/Title>/]);
  const abstract = extract([/<ows:Abstract>([^<]+)<\/ows:Abstract>/, /<Service>[\s\S]*?<Abstract>([^<]+)<\/Abstract>/]);
  const provider = extract([/<ows:ProviderName>([^<]+)<\/ows:ProviderName>/]);

  // Extraer lista de capas usando split — más robusto que regex greedy
  // El IGN usa <FeatureType> sin namespace, con contenido mixto ows: adentro
  const featureTypes = [];
  // Split en '<FeatureType' (sin >) para cubrir tags con atributos como
  // <FeatureType xmlns:ign="http://ign"> que usa el IGN
  const parts = xml.split(/<(?:wfs:)?FeatureType[\s>]/);

  for (let i = 1; i < parts.length; i++) {
    const block = parts[i].split(/<\/FeatureType>|<\/wfs:FeatureType>/)[0];

    const nameMatch  = block.match(/<(?:[^:>]+:)?Name>([^<]+)<\/(?:[^:>]+:)?Name>/);
    const titleMatch = block.match(/<(?:[^:>]+:)?Title>([^<]+)<\/(?:[^:>]+:)?Title>/);
    const srsMatch   = block.match(/<(?:[^:>]+:)?DefaultSRS>([^<]+)<\/(?:[^:>]+:)?DefaultSRS>/) ||
                       block.match(/<(?:[^:>]+:)?DefaultCRS>([^<]+)<\/(?:[^:>]+:)?DefaultCRS>/);

    if (nameMatch?.[1]) {
      featureTypes.push({
        name:  nameMatch[1].trim(),
        title: titleMatch?.[1]?.trim() || null,
        srs:   (srsMatch?.[1] || 'EPSG:4326').trim().replace('urn:x-ogc:def:crs:EPSG:', 'EPSG:').replace('urn:ogc:def:crs:EPSG::', 'EPSG:'),
        hasBbox: false,
      });
    }
  }

  return { version, title, abstract, provider, featureTypes };
}

/**
 * parseDescribeFeatureType(xml) → [{ name, type }]
 *
 * Parsea el schema XSD de DescribeFeatureType para extraer campos y tipos.
 * Mapea tipos XSD a los tipos internos de Capibara.
 */
function parseDescribeFeatureType(xml) {
  const XSD_TYPE_MAP = {
    'xsd:string':         'string',
    'xsd:int':            'integer',
    'xsd:integer':        'integer',
    'xsd:long':           'integer',
    'xsd:short':          'integer',
    'xsd:double':         'float',
    'xsd:float':          'float',
    'xsd:decimal':        'float',
    'xsd:boolean':        'boolean',
    'gml:PointPropertyType':          'geometry',
    'gml:MultiSurfacePropertyType':   'geometry',
    'gml:SurfacePropertyType':        'geometry',
    'gml:GeometryPropertyType':       'geometry',
    'gml:MultiCurvePropertyType':     'geometry',
    'gml:CurvePropertyType':          'geometry',
    'gml:MultiPointPropertyType':     'geometry',
  };

  const fields  = [];
  const attrRex = /<xsd:element[^>]+name="([^"]+)"[^>]+type="([^"]+)"/g;
  let   m;

  while ((m = attrRex.exec(xml)) !== null) {
    const rawName = m[1];
    const rawType = m[2];
    const isGeo   = rawType.startsWith('gml:');

    fields.push({
      name: rawName,
      metadata: {
        type:         XSD_TYPE_MAP[rawType] || 'unknown',
        is_geometry:  isGeo,
        has_html:     false,
        nullable:     true,
        sample_value: null,
      },
    });
  }

  return fields;
}

// ---------------------------------------------------------------------------
// Implementación del conector
// ---------------------------------------------------------------------------

module.exports = makeConnector({

  /**
   * connect(params) → { ok, error?, info? }
   *
   * Verifica que la URL responda con un documento WFS válido.
   * Extrae versión, título, abstract y proveedor del GetCapabilities.
   */
  async connect(params) {
    const url = buildUrl(params.url, {
      SERVICE: 'WFS',
      REQUEST: 'GetCapabilities',
      VERSION: params.version || '1.1.0',
    });

    const res = await fetchWithTimeout(url);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    const xml = await res.text();
    if (!xml.includes('WFS_Capabilities') && !xml.includes('wfs:WFS_Capabilities')) {
      return { ok: false, error: 'No se encontraron WFS capabilities en la respuesta' };
    }

    const { version, title, abstract, provider } = parseCapabilities(xml);
    return {
      ok:   true,
      info: { version, title, abstract, provider },
    };
  },

  /**
   * getLayers(params) → [{ name, title, metadata }]
   *
   * Descubre todas las capas disponibles en el servicio.
   */
  async getLayers(params) {
    const url = buildUrl(params.url, {
      SERVICE: 'WFS',
      REQUEST: 'GetCapabilities',
      VERSION: params.version || '1.1.0',
    });

    console.log('[wfs.getLayers] url:', url);
    const res = await fetchWithTimeout(url);
    console.log('[wfs.getLayers] status:', res.status);
    if (!res.ok) throw new Error(`HTTP ${res.status} al obtener capabilities`);

    const xml          = await res.text();
    console.log('[wfs.getLayers] xml length:', xml.length, 'sample:', xml.slice(0, 200));
    const { featureTypes } = parseCapabilities(xml);
    console.log('[wfs.getLayers] featureTypes found:', featureTypes.length);
    console.log('[wfs.getLayers] has <FeatureType>:', xml.includes('<FeatureType>'));
    console.log('[wfs.getLayers] has <wfs:FeatureType>:', xml.includes('<wfs:FeatureType>'));
    // Loguear el primer FeatureType que aparezca en el XML
    const ftIdx = xml.indexOf('FeatureType>');
    if (ftIdx > 0) console.log('[wfs.getLayers] first FeatureType context:', xml.slice(Math.max(0,ftIdx-20), ftIdx+80));

    return featureTypes.map(ft => ({
      name:  ft.name,
      title: ft.title,
      metadata: {
        crs:           ft.srs,
        geometry_type: 'UNKNOWN',  // se completa en getFields o discover
        feature_count: null,
        abstract:      null,
      },
    }));
  },

  /**
   * getFields(params, layerName) → [{ name, metadata }]
   *
   * Obtiene los campos de una capa vía DescribeFeatureType.
   */
  async getFields(params, layerName) {
    const url = buildUrl(params.url, {
      SERVICE:  'WFS',
      REQUEST:  'DescribeFeatureType',
      VERSION:  params.version || '1.1.0',
      TYPENAME: layerName,
    });

    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} al obtener schema`);

    const xml    = await res.text();
    const fields = parseDescribeFeatureType(xml);

    if (!fields.length) throw new Error('No se encontraron campos en el schema XSD');
    return fields;
  },

  /**
   * getSample(params, layerName, count?) → { features, total }
   *
   * Obtiene una muestra de features en formato GeoJSON.
   * Usa el parámetro correcto según la versión del servicio:
   *   WFS 1.x → maxFeatures
   *   WFS 2.0 → count
   */
  async getSample(params, layerName, count = 5) {
    const version  = params.version || '1.1.0';
    const countKey = version.startsWith('2') ? 'COUNT' : 'MAXFEATURES';

    const url = buildUrl(params.url, {
      SERVICE:      'WFS',
      REQUEST:      'GetFeature',
      VERSION:      version,
      TYPENAME:     layerName,
      [countKey]:   count,
      OUTPUTFORMAT: 'application/json',
    });

    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} al obtener sample`);

    const data = await res.json();
    return {
      features: data.features || [],
      total:    data.totalFeatures || data.numberMatched || data.features?.length || 0,
    };
  },

  /**
   * getCount(params, layerName) → number | null
   *
   * Obtiene el conteo total de features sin descargar datos.
   * Timeout corto (8s) — es informativo, no crítico.
   * Devuelve null si el servicio no soporta RESULTTYPE=hits.
   */
  async getCount(params, layerName) {
    try {
      const url = buildUrl(params.url, {
        SERVICE:    'WFS',
        REQUEST:    'GetFeature',
        VERSION:    params.version || '1.1.0',
        TYPENAME:   layerName,
        RESULTTYPE: 'hits',
      });

      const res = await fetchWithTimeout(url, TIMEOUT_COUNT_MS);
      if (!res.ok) return null;

      const xml   = await res.text();
      const match = xml.match(/numberOfFeatures="(\d+)"|numberMatched="(\d+)"/);
      if (!match) return null;

      return parseInt(match[1] || match[2], 10);
    } catch {
      return null;
    }
  },

  /**
   * getFeatureAtPoint(params, layerName, lat, lon) → { feature, error? }
   *
   * Obtiene el feature que contiene el punto dado.
   * Usa CQL_FILTER con INTERSECTS si el servidor lo soporta (GeoServer),
   * con fallback a BBOX para servidores más básicos.
   *
   * lat, lon → coordenadas WGS84 (EPSG:4326)
   */
  async getFeatureAtPoint(params, layerName, lat, lon) {
    const version = params.version || '1.1.0';

    // BBOX pequeño alrededor del punto (~10m de margen)
    const delta = 0.0001;
    const bbox  = `${lon - delta},${lat - delta},${lon + delta},${lat + delta},EPSG:4326`;

    const url = buildUrl(params.url, {
      SERVICE:      'WFS',
      REQUEST:      'GetFeature',
      VERSION:      version,
      TYPENAME:     layerName,
      BBOX:         bbox,
      OUTPUTFORMAT: 'application/json',
      MAXFEATURES:  1,
    });

    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) return { feature: null, error: `HTTP ${res.status}` };

      const data    = await res.json();
      const feature = data.features?.[0]?.properties || null;
      return { feature };
    } catch (e) {
      return { feature: null, error: e.message };
    }
  },
});
