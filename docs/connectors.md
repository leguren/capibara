# docs/connectors.md — Sistema de conectores

## Interfaz (_connectors/_interface.js)

Todo conector debe implementar estos métodos:

  connect(params)                        → { ok, error?, info? }
  getLayers(params)                      → [{ name, title, metadata }]
  getFields(params, layerName)           → [{ name, metadata }]
  getSample(params, layerName, count?)   → { features, total }
  getFeatureAtPoint(params, layerName, lat, lon) → { feature, error? }

Opcional:
  getCount(params, layerName)            → number | null

params = objeto parseado de sources.connection_params

Reglas:
- connect() NUNCA lanza — devuelve { ok: false, error: msg }
- getLayers/getFields/getSample/getFeatureAtPoint SÍ pueden lanzar (el handler los envuelve)
- makeConnector(impl) valida la interfaz y envuelve connect() para garantizar no-throw

## Registro (_connectors/_registry.js)

Fuente única de verdad de conectores disponibles.
Para agregar uno nuevo:
  1. Crear api/_connectors/{tipo}.js
  2. Agregar entrada en REGISTRY con implemented: true
  3. Listo — el sistema lo detecta automáticamente

## Conectores implementados

### WFS (wfs.js)
OGC Web Feature Service 1.0.0, 1.1.0 y 2.0.0.

- connect: GetCapabilities
- getLayers: FeatureTypeList del GetCapabilities
- getFields: DescribeFeatureType → schema XSD
- getSample: GetFeature con maxFeatures/count + OUTPUTFORMAT=json
- getCount: GetFeature con RESULTTYPE=hits (timeout 8s)
- getFeatureAtPoint: GetFeature con BBOX pequeño (~10m de margen)

Notas:
- buildUrl() limpia todos los query params antes de construir cada request
- removeNSPrefix elimina namespaces: 'ign:provincia' → 'provincia'
- WFS 2.0 usa COUNT en lugar de MAXFEATURES

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

Devuelve: { format, confidence: 'high'|'medium', from, detected_params }
