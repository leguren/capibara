# docs/connectors.md — Sistema de conectores

## Interfaz (_connectors/_interface.js)

Todo conector debe implementar estos métodos:

  connect(params)                               → { ok, error?, info? }
  getLayers(params)                             → [{ name, title, abstract, bbox, metadata }]
  getGeomTypes(params, timeoutMs, layerNames?)  → { layerLocalName: 'POINT'|'LINE'|'POLYGON'|'GEOMETRY' }
  getFields(params, layerName)                  → [{ name, metadata }]
  getSample(params, layerName, count?)          → { features, total }
  getFeatureAtPoint(params, layerName, lat, lon) → { feature, error? }

Opcional:
  getCount(params, layerName)                   → number | null

params = objeto parseado de sources.connection_params

Reglas:
- connect() NUNCA lanza — devuelve { ok: false, error: msg }
- getLayers/getFields/getSample/getFeatureAtPoint SÍ pueden lanzar (el handler los envuelve)
- makeConnector(impl) valida la interfaz y envuelve connect() para garantizar no-throw
- getGeomTypes() NUNCA lanza — devuelve {} ante cualquier error

## getLayers — campos retornados

Cada capa retornada por getLayers incluye:
  name     — nombre técnico completo (ej: 'ign:municipios')
  title    — título legible del servicio (puede ser null)
  abstract — descripción OGC de la capa (puede ser null)
  bbox     — { min_lat, max_lat, min_lon, max_lon } | null
  metadata — { crs, geometry_type: 'UNKNOWN', feature_count: null }

abstract y bbox se persisten en columnas directas de la tabla layers.

## getGeomTypes — estrategia de detección

Intenta detectar el tipo de geometría de todas las capas:

  Paso 1 — Batch: un solo DescribeFeatureType sin TYPENAME
    Si el servidor devuelve complexTypes inline → parsea y retorna
    Si devuelve solo xsd:import (schemas externos) → va al paso 2

  Paso 2 — Fallback individual: DescribeFeatureType por TYPENAME
    Máximo 20 capas en paralelo, timeout 2s cada una
    Solo se activa cuando el batch devuelve 0 tipos

Tipos de geometría mapeados:
  PointPropertyType, MultiPointPropertyType              → 'POINT'
  LineStringPropertyType, MultiLineStringPropertyType,
  CurvePropertyType, MultiCurvePropertyType              → 'LINE'
  PolygonPropertyType, MultiPolygonPropertyType,
  SurfacePropertyType, MultiSurfacePropertyType,
  CompositeSurfacePropertyType                           → 'POLYGON'
  GeometryPropertyType, AbstractGeometryType,
  GeometryCollectionPropertyType                         → 'GEOMETRY'

Nota: 'GEOMETRY' significa que el schema XSD declara tipo genérico sin especificar
subtipo. Para resolverlo exactamente se requeriría GetFeature con 1 feature (pendiente).

## Registro (_connectors/_registry.js)

Fuente única de verdad de conectores disponibles.
Para agregar uno nuevo:
  1. Crear api/_connectors/{tipo}.js
  2. Agregar entrada en REGISTRY con implemented: true
  3. Listo — el sistema lo detecta automáticamente

## Conectores implementados

### WFS (wfs.js)
OGC Web Feature Service 1.0.0, 1.1.0 y 2.0.0.

- connect: GetCapabilities — retorna version, title, abstract, provider
- getLayers: FeatureTypeList → incluye abstract y WGS84BoundingBox por capa
- getGeomTypes: DescribeFeatureType batch con fallback individual
- getFields: DescribeFeatureType con TYPENAME → schema XSD
- getSample: GetFeature con maxFeatures/count + OUTPUTFORMAT=application/json
- getCount: GetFeature con RESULTTYPE=hits (timeout 8s)
- getFeatureAtPoint: GetFeature con BBOX pequeño (~10m de margen)

Notas:
- buildUrl() limpia todos los query params antes de construir cada request
- Versión detectada desde <ows:ServiceTypeVersion> (canónico en WFS 1.1.0+),
  con fallback a atributo version= en el tag WFS_Capabilities
- WFS 2.0 usa COUNT en lugar de MAXFEATURES
- Elementos con type de namespace propio (ej: SHN:ARASANJUANType) son filtrados
  de getFields — son el feature container de GeoServer, no campos de datos

### ArcGIS REST (arcgis.js)
FeatureServer y MapServer.

- El name_source de cada capa es su ID numérico ('0', '1', '2')
- getFeatureAtPoint: geometry point con esriSpatialRelIntersects
- El campo alias de ArcGIS se usa como candidato a name_alias

### CSV (csv.js)
- Detección automática de columnas lat/lon por nombre
- Nombres reconocidos de lat: lat, latitude, latitud, y, lat_y
- Nombres reconocidos de lon: lon, lng, longitude, longitud, x, lon_x
- getFeatureAtPoint: busca el punto más cercano dentro de ~500m
- Soporta delimitadores configurables vía params.delimiter

### GeoJSON (geojson.js)
- Siempre EPSG:4326 (RFC 7946)
- Acepta FeatureCollection, Feature individual, o geometría simple
- getFeatureAtPoint: ray-casting point-in-polygon para Polygon y MultiPolygon
- Para Point: threshold de ~50m

### JSON (json.js)
Múltiples formatos:
- Google Sheets API: { majorDimension: 'ROWS', values: [[...]] }
- Array de arrays: [[col1, col2], [val1, val2]]
- Array de objetos: [{ campo: valor }, ...]
- Objeto con array interno: { data: [...] }, { items: [...] }, etc.

Limitación importante: NO soporta getFeatureAtPoint (sin geometría propia).
Si el JSON tiene columnas lat/lon, usar el conector CSV en su lugar.

Limpieza de HTML: valores con tags HTML se limpian automáticamente.
Labels de Google Sheets (segunda fila como etiquetas legibles) se capturan como name_alias candidato.

## Conectores pendientes

xlsx: implementar lectura de archivos Excel.
rss: implementar feeds RSS/Atom como capas de eventos.
network (fuera de scope): requiere infraestructura de routing (pgRouting/OSRM).

## Detección automática (admin/detect.js)

4 pasos en orden de confianza:
  1. Heurística de URL (parámetros, paths, extensiones)
  2. Content-Type del response
  3. Estructura del cuerpo del response (primeros 8KB)
  4. Probe WFS (agrega GetCapabilities a la URL base)

Devuelve: { format, confidence: 'high'|'medium', from, detected_params, implemented }
implemented: boolean — si Capibara tiene conector operativo para ese formato
