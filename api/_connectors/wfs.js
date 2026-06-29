/**
 * api/_connectors/wfs.js — Conector OGC Web Feature Service
 *
 * Implementa la interfaz completa para servicios WFS 1.0.0, 1.1.0 y 2.0.0.
 *
 * Operaciones:
 *   connect           → GetCapabilities — extrae versión, título, abstract, proveedor
 *   getLayers         → GetCapabilities — lista FeatureTypeList
 *   getFields         → DescribeFeatureType — analiza schema XSD
 *   getSample         → GetFeature con maxFeatures/count + OUTPUTFORMAT=json
 *   getCount          → GetFeature con RESULTTYPE=hits
 *   getFeatureAtPoint → GetFeature con BBOX para point-in-polygon
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
 * parseCapabilities(xml) → { version, title, abstract, provider, featureTypes }
 *
 * Parsea XML de GetCapabilities.
 * Usa split en lugar de regex greedy para manejar <FeatureType> con atributos
 * como <FeatureType xmlns:ign="http://ign"> que usan el IGN y otros servidores.
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

  // Split en '<FeatureType' (sin >) para cubrir tags con atributos arbitrarios
  // como <FeatureType xmlns:ign="http://ign"> que usa el IGN
  const featureTypes = [];
  const parts = xml.split(/<(?:wfs:)?FeatureType[\s>]/);

  for (let i = 1; i < parts.length; i++) {
    const block = parts[i].split(/<\/(?:wfs:)?FeatureType>/)[0];

    const nameMatch  = block.match(/<(?:[^:>]+:)?Name>([^<]+)<\/(?:[^:>]+:)?Name>/);
    const titleMatch = block.match(/<(?:[^:>]+:)?Title>([^<]+)<\/(?:[^:>]+:)?Title>/);
    const srsMatch   = block.match(/<(?:[^:>]+:)?DefaultSRS>([^<]+)<\/(?:[^:>]+:)?DefaultSRS>/) ||
                       block.match(/<(?:[^:>]+:)?DefaultCRS>([^<]+)<\/(?:[^:>]+:)?DefaultCRS>/);

    if (nameMatch?.[1]) {
      const rawSrs = srsMatch?.[1] || 'EPSG:4326';
      featureTypes.push({
        name:  nameMatch[1].trim(),
        title: titleMatch?.[1]?.trim() || null,
        srs:   rawSrs.trim()
               .replace('urn:x-ogc:def:crs:EPSG:', 'EPSG:')
               .replace('urn:ogc:def:crs:EPSG::', 'EPSG:'),
      });
    }
  }

  return { version, title, abstract, provider, featureTypes };
}

/**
 * getAttr(elementStr, attrName) → string | null
 *
 * Extrae el valor de un atributo de un tag XML, independientemente del orden.
 * Soluciona el bug donde el regex requería name antes que type en xsd:element.
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

  const fields = [];

  // Extraer todos los tags xsd:element (o xs:element) — self-closing o no
  const elementRex = /<(?:xsd?:)element\b([^>]*?)(?:\/>|>)/g;
  let m;

  while ((m = elementRex.exec(xml)) !== null) {
    const attrs   = m[1];
    const name    = getAttr(attrs, 'name');
    const rawType = getAttr(attrs, 'type');

    // Ignorar elementos sin name o sin type, y elementos abstractos/de grupo
    if (!name || !rawType) continue;
    // Ignorar elementos que son contenedores abstractos
    if (name === 'boundedBy' || name === 'location') continue;

    const isGeo = rawType.startsWith('gml:');
    fields.push({
      name,
      metadata: {
        type:         XSD_TYPE_MAP[rawType] || 'unknown',
        is_geometry:  isGeo,
        has_html:     false,
        nullable:     getAttr(attrs, 'nillable') === 'true',
        sample_value: null,
      },
    });
  }

  return fields;
}


/**
 * parseGeomTypes(xml) → { localLayerName: 'POINT'|'LINE'|'POLYGON'|'GEOMETRY' }
 *
 * Parsea un DescribeFeatureType multi-tipo y extrae el tipo de geometría por capa.
 * Una sola request para todas las capas del servicio (batch).
 *
 * TODO: Aplicar patrón similar en los demás conectores (ArcGIS, etc.)
 *       cuando sus APIs soporten introspección de esquema en batch.
 */
function parseGeomTypes(xml) {
  const GML_MAP = {
    'gml:PointPropertyType':        'POINT',
    'gml:MultiPointPropertyType':   'POINT',
    'gml:CurvePropertyType':        'LINE',
    'gml:MultiCurvePropertyType':   'LINE',
    'gml:LineStringPropertyType':   'LINE',
    'gml:SurfacePropertyType':      'POLYGON',
    'gml:MultiSurfacePropertyType': 'POLYGON',
    'gml:PolygonPropertyType':      'POLYGON',
    'gml:MultiPolygonPropertyType': 'POLYGON',
    'gml:GeometryPropertyType':     'GEOMETRY',
    'gml:AbstractGeometryType':     'GEOMETRY',
  };

  const result = {};
  // Cada complexType corresponde a una capa. Su nombre es "NombreCapaType".
  const blocks = xml.split(/<(?:xsd?:)complexType/);

  for (let i = 1; i < blocks.length; i++) {
    const block    = blocks[i];
    const nameM    = block.match(/\bname="([^"]+)"/);
    if (!nameM) continue;

    const typeName = nameM[1]; // e.g. "LocalidadType" o "ign_LocalidadType"
    // Quitar sufijo "Type" y posible prefijo de namespace
    const stripped = typeName.replace(/Type$/, '');
    const local    = stripped.includes('_') ? stripped.slice(stripped.indexOf('_') + 1) : stripped;

    for (const [gmlType, geomLabel] of Object.entries(GML_MAP)) {
      if (block.includes(`type="${gmlType}"`)) {
        result[local]    = geomLabel;
        result[stripped] = geomLabel; // clave alternativa
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
   * getLayers(params) → [{ name, title, metadata }]
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

    // ── Geometry types en batch — 1 sola request para todas las capas ──────
    // TODO: Aplicar patrón similar en ArcGIS (usa geometryType por capa en el
    //       root JSON, verificar bug de mapeo), CSV, GeoJSON y demás conectores.
    const geomTypes = {};
    try {
      const typeNames = featureTypes.map(ft => ft.name).join(',');
      const descUrl   = buildUrl(params.url, {
        SERVICE:   'WFS',
        REQUEST:   'DescribeFeatureType',
        VERSION:   params.version || '1.1.0',
        TYPENAMES: typeNames, // WFS 2.0
        TYPENAME:  typeNames, // WFS 1.x — algunos servidores solo aceptan este
      });
      const descRes = await fetchWithTimeout(descUrl, TIMEOUT_MS);
      if (descRes.ok) Object.assign(geomTypes, parseGeomTypes(await descRes.text()));
    } catch (_) {
      // Falla silenciosa — geometry_type quedará UNKNOWN para las capas afectadas
    }

    return featureTypes.map(ft => {
      const local   = ft.name.includes(':') ? ft.name.split(':').pop() : ft.name;
      const geomType = geomTypes[local] || geomTypes[ft.name] || 'UNKNOWN';
      return {
        name:  ft.name,
        title: ft.title,
        metadata: {
          crs:           ft.srs,
          geometry_type: geomType,
          feature_count: null,
          abstract:      null,
        },
      };
    });
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
