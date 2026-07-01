/**
 * api/_connectors/wfs.js — Conector OGC Web Feature Service
 *
 * Implementa la interfaz completa para servicios WFS 1.0.0, 1.1.0 y 2.0.0.
 *
 * Operaciones:
 *   connect           → GetCapabilities — extrae versión, título, abstract, proveedor
 *   getLayers         → GetCapabilities — lista FeatureTypeList con abstract y bbox
 *   getFields         → DescribeFeatureType — analiza schema XSD
 *   getSample         → GetFeature con maxFeatures/count + OUTPUTFORMAT=json
 *   getCount          → GetFeature con RESULTTYPE=hits
 *   getFeatureAtPoint → GetFeature con BBOX para point-in-polygon
 *   getGeomTypes      → DescribeFeatureType batch — detecta geometría por capa
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
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * normalizeSrs(raw) → string
 *
 * Normaliza formatos URN de SRS a EPSG:XXXX.
 */
function normalizeSrs(raw) {
  return raw.trim()
    .replace('urn:x-ogc:def:crs:EPSG:', 'EPSG:')
    .replace('urn:ogc:def:crs:EPSG::', 'EPSG:');
}

/**
 * parseCapabilities(xml) → { version, title, abstract, provider, featureTypes }
 *
 * Parsea XML de GetCapabilities.
 * Usa split en lugar de regex greedy para manejar <FeatureType> con atributos
 * como <FeatureType xmlns:ign="http://ign"> que usan el IGN y otros servidores.
 *
 * Por capa extrae: name, title, abstract, srs y WGS84BoundingBox.
 */
function parseCapabilities(xml) {
  const extract = (patterns, fallback = null) => {
    for (const pattern of patterns) {
      const m = xml.match(pattern);
      if (m?.[1]?.trim()) return m[1].trim();
    }
    return fallback;
  };

  // BUG 1 FIX: <ows:ServiceTypeVersion> es la fuente canónica de versión en WFS 1.1.0+.
  // El primer atributo version= del documento puede pertenecer a xsi:schemaLocation
  // u otros elementos antes del tag WFS_Capabilities, dando un valor incorrecto.
  const version  = extract([
    /<ows:ServiceTypeVersion>([^<]+)<\/ows:ServiceTypeVersion>/,
    /WFS_Capabilities[^>]+version="([^"]+)"/,
  ]);
  const title    = extract([/<ows:Title>([^<]+)<\/ows:Title>/, /<Service>[\s\S]*?<Title>([^<]+)<\/Title>/]);
  const abstract = extract([/<ows:Abstract>([^<]+)<\/ows:Abstract>/, /<Service>[\s\S]*?<Abstract>([^<]+)<\/Abstract>/]);
  const provider = extract([/<ows:ProviderName>([^<]+)<\/ows:ProviderName>/]);

  // Split en '<FeatureType' (sin >) para cubrir tags con atributos arbitrarios
  // como <FeatureType xmlns:ign="http://ign"> que usa el IGN
  const featureTypes = [];
  const parts = xml.split(/<(?:wfs:)?FeatureType[\s>]/);

  for (let i = 1; i < parts.length; i++) {
    const block = parts[i].split(/<\/(?:wfs:)?FeatureType>/)[0];

    const nameMatch     = block.match(/<(?:[^:>]+:)?Name>([^<]+)<\/(?:[^:>]+:)?Name>/);
    const titleMatch    = block.match(/<(?:[^:>]+:)?Title>([^<]+)<\/(?:[^:>]+:)?Title>/);
    const abstractMatch = block.match(/<(?:[^:>]+:)?Abstract>([^<]+)<\/(?:[^:>]+:)?Abstract>/);
    const srsMatch      = block.match(/<(?:[^:>]+:)?DefaultSRS>([^<]+)<\/(?:[^:>]+:)?DefaultSRS>/) ||
                          block.match(/<(?:[^:>]+:)?DefaultCRS>([^<]+)<\/(?:[^:>]+:)?DefaultCRS>/);

    // BUG 6+7 FIX: WGS84BoundingBox — presente en prácticamente todos los GeoServer.
    // Formato LowerCorner/UpperCorner: "lon lat" (x y).
    // Alimenta directamente min_lat/max_lat/min_lon/max_lon en la tabla layers.
    const bboxMatch = block.match(
      /<ows:LowerCorner>([^<]+)<\/ows:LowerCorner>[\s\S]*?<ows:UpperCorner>([^<]+)<\/ows:UpperCorner>/
    );

    if (nameMatch?.[1]) {
      const rawSrs = srsMatch?.[1] || 'EPSG:4326';

      let bbox = null;
      if (bboxMatch) {
        const [lonMin, latMin] = bboxMatch[1].trim().split(/\s+/).map(Number);
        const [lonMax, latMax] = bboxMatch[2].trim().split(/\s+/).map(Number);
        if (!isNaN(lonMin) && !isNaN(latMin) && !isNaN(lonMax) && !isNaN(latMax)) {
          bbox = { min_lon: lonMin, min_lat: latMin, max_lon: lonMax, max_lat: latMax };
        }
      }

      featureTypes.push({
        name:     nameMatch[1].trim(),
        title:    titleMatch?.[1]?.trim()    || null,
        abstract: abstractMatch?.[1]?.trim() || null,
        bbox,
        srs:      normalizeSrs(rawSrs),
      });
    }
  }

  return { version, title, abstract, provider, featureTypes };
}

/**
 * getAttr(elementStr, attrName) → string | null
 *
 * Extrae el valor de un atributo de un tag XML, independientemente del orden.
 */
function getAttr(str, attrName) {
  const m = str.match(new RegExp(`\\b${attrName}="([^"]+)"`));
  return m ? m[1] : null;
}

/**
 * parseDescribeFeatureType(xml) → [{ name, metadata }]
 *
 * Parsea el schema XSD de DescribeFeatureType.
 * Extrae cada atributo independientemente para soportar cualquier orden.
 * Mapea tipos XSD a los tipos internos de Capibara.
 *
 * BUG 2 FIX: GeoServer incluye al final de cada schema un xsd:element cuyo
 * type referencia el complexType propio de la capa (ej: type="SHN:ARASANJUANType").
 * No es un campo de datos — es la declaración del feature container.
 * Se filtra descartando cualquier type con prefijo de namespace distinto a
 * gml, xsd o xs (que son los únicos que representan campos reales).
 */
function parseDescribeFeatureType(xml) {
  const XSD_TYPE_MAP = {
    'xsd:string':   'string',   'xs:string':   'string',
    'xsd:int':      'integer',  'xs:int':      'integer',
    'xsd:integer':  'integer',  'xs:integer':  'integer',
    'xsd:long':     'integer',  'xs:long':     'integer',
    'xsd:short':    'integer',  'xs:short':    'integer',
    'xsd:double':   'float',    'xs:double':   'float',
    'xsd:float':    'float',    'xs:float':    'float',
    'xsd:decimal':  'float',    'xs:decimal':  'float',
    'xsd:boolean':  'boolean',  'xs:boolean':  'boolean',
    'xsd:date':     'string',   'xs:date':     'string',
    'xsd:dateTime': 'string',   'xs:dateTime': 'string',
    'gml:PointPropertyType':          'geometry',
    'gml:MultiSurfacePropertyType':   'geometry',
    'gml:SurfacePropertyType':        'geometry',
    'gml:GeometryPropertyType':       'geometry',
    'gml:MultiCurvePropertyType':     'geometry',
    'gml:CurvePropertyType':          'geometry',
    'gml:MultiPointPropertyType':     'geometry',
    'gml:MultiPolygonPropertyType':   'geometry',
    'gml:PolygonPropertyType':        'geometry',
    'gml:LineStringPropertyType':     'geometry',
  };

  // Prefijos de namespace que representan campos reales.
  // Cualquier otro prefijo (SHN:, ign:, publico:, etc.) es el feature container de GeoServer.
  const KNOWN_PREFIXES = new Set(['gml', 'xsd', 'xs']);

  const fields = [];
  const elementRex = /<(?:xsd?:)element\b([^>]*?)(?:\/>|>)/g;
  let m;

  while ((m = elementRex.exec(xml)) !== null) {
    const attrs   = m[1];
    const name    = getAttr(attrs, 'name');
    const rawType = getAttr(attrs, 'type');

    if (!name || !rawType) continue;
    if (name === 'boundedBy' || name === 'location') continue;

    // BUG 2 FIX: descartar elementos con namespace propio (feature container de GeoServer)
    const prefix = rawType.includes(':') ? rawType.split(':')[0] : null;
    if (prefix && !KNOWN_PREFIXES.has(prefix)) continue;

    const isGeo = rawType.startsWith('gml:');
    fields.push({
      name,
      metadata: {
        type:         XSD_TYPE_MAP[rawType] || 'unknown',
        is_geometry:  isGeo,
        gml_type:     isGeo ? rawType : null,
        has_html:     false,
        nullable:     getAttr(attrs, 'nillable') === 'true',
        sample_value: null,
      },
    });
  }

  return fields;
}

/**
 * parseGeomTypes(xml) → { layerLocalName: 'POINT'|'LINE'|'POLYGON'|'GEOMETRY' }
 *
 * Parsea un DescribeFeatureType (batch o individual) y extrae el tipo de geometría.
 *
 * BUG 4 FIX: la versión anterior cortaba el nombre del complexType en el primer '_'
 * para intentar extraer un nombre "local", produciendo keys incorrectos para capas
 * con múltiples underscores (ej: "doscientas_millas_sector_antartico" → "millas_...").
 * Ahora solo se guarda el nombre completo sin el sufijo "Type" (stripped), que es
 * exactamente lo que el discover handler busca al hacer layer.name.split(':').pop().
 *
 * También se eliminan underscores finales para cubrir tipos como "ms_barrios_Type".
 */
function parseGeomTypes(xml) {
  const GML_SUFFIXES = {
    'PointPropertyType':              'POINT',
    'MultiPointPropertyType':         'POINT',
    'CurvePropertyType':              'LINE',
    'MultiCurvePropertyType':         'LINE',
    'LineStringPropertyType':         'LINE',
    'MultiLineStringPropertyType':    'LINE',
    'SurfacePropertyType':            'POLYGON',
    'MultiSurfacePropertyType':       'POLYGON',
    'PolygonPropertyType':            'POLYGON',
    'MultiPolygonPropertyType':       'POLYGON',
    'CompositeSurfacePropertyType':   'POLYGON',
    'GeometryPropertyType':           'GEOMETRY',
    'AbstractGeometryType':           'GEOMETRY',
    'GeometryCollectionPropertyType': 'GEOMETRY',
  };

  const result = {};
  const blocks = xml.split(/<(?:xsd?:)complexType\b/);

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const nameM = block.match(/\bname="([^"]+)"/);
    if (!nameM) continue;

    // BUG 4 FIX: strip "Type" y underscores finales. No cortar en primer "_".
    const stripped = nameM[1].replace(/Type$/, '').replace(/_+$/, '');
    if (!stripped) continue;

    for (const [suffix, geomLabel] of Object.entries(GML_SUFFIXES)) {
      if (block.includes(`:${suffix}"`)) {
        result[stripped] = geomLabel;
        break;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Implementación del conector
// ---------------------------------------------------------------------------

module.exports = makeConnector({

  /**
   * connect(params) → { ok, error?, info? }
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
    return { ok: true, info: { version, title, abstract, provider } };
  },

  /**
   * getLayers(params) → [{ name, title, abstract, bbox, metadata }]
   *
   * BUG 6+7: ahora retorna abstract y bbox por capa para que el discover handler
   * los persista en las columnas directas abstract, min_lat/max_lat/min_lon/max_lon.
   */
  async getLayers(params) {
    const capUrl = buildUrl(params.url, {
      SERVICE: 'WFS',
      REQUEST: 'GetCapabilities',
      VERSION: params.version || '1.1.0',
    });

    const capRes = await fetchWithTimeout(capUrl);
    if (!capRes.ok) throw new Error(`HTTP ${capRes.status} al obtener capabilities`);

    const xml              = await capRes.text();
    const { featureTypes } = parseCapabilities(xml);

    // geometry_type se detecta en getGeomTypes (post-insert). Aquí siempre UNKNOWN.
    return featureTypes.map(ft => ({
      name:     ft.name,
      title:    ft.title,
      abstract: ft.abstract,
      bbox:     ft.bbox,
      metadata: { crs: ft.srs, geometry_type: 'UNKNOWN', feature_count: null },
    }));
  },

  /**
   * getGeomTypes(params, timeoutMs, layerNames) → { layerLocalName: 'POINT'|... }
   *
   * Intenta detectar geometrías de todas las capas en una sola request batch.
   * Si el servidor responde con imports externos (sin complexType inline),
   * hace fallback a requests individuales por TYPENAME para cada capa.
   *
   * BUG 3 FIX: servidores como SHN y Educacion devuelven un schema batch que
   * solo contiene xsd:import con URLs externas, sin definir complexTypes inline.
   * En ese caso, el batch produce 0 resultados. El fallback individual resuelve
   * esto para servicios con cantidad razonable de capas (máximo MAX_INDIVIDUAL).
   *
   * @param {object} params        - connection_params de la fuente
   * @param {number} timeoutMs     - timeout para el request batch
   * @param {string[]} layerNames  - nombres de capas (para fallback individual)
   */
  async getGeomTypes(params, timeoutMs = 4_000, layerNames = []) {
    const MAX_INDIVIDUAL = 20;

    // ── Paso 1: intentar batch (una sola request para todas las capas) ──────
    let batchHadImportsOnly = false;
    try {
      const url = buildUrl(params.url, {
        SERVICE: 'WFS',
        REQUEST: 'DescribeFeatureType',
        VERSION: params.version || '1.1.0',
      });
      const res  = await fetchWithTimeout(url, timeoutMs);
      const text = await res.text();

      if (res.ok && text.includes('complexType')) {
        const types = parseGeomTypes(text);
        if (Object.keys(types).length > 0) {
          console.log('[getGeomTypes] batch OK:', Object.keys(types).length, 'tipos');
          return types;
        }
      }

      // Detectar si el batch solo tenía imports sin definiciones inline
      if (text.includes('xsd:import') && !text.includes('complexType')) {
        batchHadImportsOnly = true;
        console.log('[getGeomTypes] batch solo con imports — activando fallback individual');
      }
    } catch (e) {
      console.warn('[getGeomTypes] batch falló:', e.message);
    }

    // ── Paso 2: fallback individual por TYPENAME ──────────────────────────
    // Solo si el batch falló por imports y tenemos nombres de capas.
    // Se limita a MAX_INDIVIDUAL para no exceder el timeout de Vercel.
    if (!batchHadImportsOnly || !layerNames.length) return {};

    const toFetch = layerNames.slice(0, MAX_INDIVIDUAL);
    const result  = {};

    await Promise.all(toFetch.map(async (layerName) => {
      try {
        const url = buildUrl(params.url, {
          SERVICE:  'WFS',
          REQUEST:  'DescribeFeatureType',
          VERSION:  params.version || '1.1.0',
          TYPENAME: layerName,
        });
        const res  = await fetchWithTimeout(url, 2_000);
        const text = await res.text();
        if (!res.ok || !text.includes('complexType')) return;

        const types = parseGeomTypes(text);
        const local = layerName.includes(':') ? layerName.split(':').pop() : layerName;
        // El tipo puede estar keyed por el nombre local o por el stripped del complexType
        const geomType = types[local] || Object.values(types)[0];
        if (geomType) result[local] = geomType;
      } catch { /* skip esta capa, quedará UNKNOWN */ }
    }));

    console.log('[getGeomTypes] fallback individual:', Object.keys(result).length, 'tipos de', toFetch.length, 'capas');
    return result;
  },

  /**
   * getFields(params, layerName) → [{ name, metadata }]
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
   */
  async getFeatureAtPoint(params, layerName, lat, lon) {
    const version = params.version || '1.1.0';
    const delta   = 0.0001;
    const bbox    = `${lon - delta},${lat - delta},${lon + delta},${lat + delta},EPSG:4326`;

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
