# docs/api-geo.md — API Pública /api/geo/1/

## Autenticación
Todas las rutas excepto /catalog/* requieren:
  Authorization: Bearer cpb_<token>

El token se genera en el dashboard (/dashboard).

## Endpoints

### GET /api/geo/1/query

El endpoint central del producto.

Parámetros:
  lat       (requerido) — latitud decimal WGS84. Ejemplo: -34.603
  lon       (requerido) — longitud decimal WGS84. Ejemplo: -58.382
  precision (opcional)  — decimales de redondeo para caché key. Default: 3 (~111m)
  domain    (opcional)  — filtrar por dominio/s separados por coma. Ejemplo: geo,environment

Respuesta 200:
{
  "lat": -34.603,
  "lon": -58.382,
  "queried_at": "2025-01-15T14:23:01.000Z",
  "cache_ttl": 86400,
  "response_ms": 234,
  "data": [
    {
      "source_id": "src_abc123",
      "source_name": "IGN",
      "layer_id": "lyr_xyz789",
      "layer_name": "Provincias",
      "domain": "geo",
      "feature": {
        "Provincia": "Buenos Aires",
        "Código": "06"
      }
    }
  ],
  "errors": [
    {
      "source_id": "src_def456",
      "layer_id": "lyr_uvw012",
      "layer_name": "Municipios",
      "error": "timeout"
    }
  ]
}

Notas:
- Los nombres de campos en feature usan name_alias si existe, name_source si no.
- errors solo aparece si hubo errores parciales. La respuesta es parcial, no falla total.
- cache_ttl: segundos. Basado en el update_frequency de la capa más dinámica del resultado.
- El header Cache-Control se setea automáticamente con s-maxage=cache_ttl.

### GET /api/geo/1/query/demo

Versión pública sin autenticación — misma forma de respuesta que `/query`,
pero limitada a las primeras 3 capas disponibles en el bbox consultado
(pensada para que un prospecto pruebe sin crear cuenta, desde `/explore`).
Limitada a 20 requests/min por IP.

### GET /api/geo/1/query/preview

Requiere sesión (cookie), no API key — pensada para el dashboard propio,
no para integraciones externas. Acceso completo, sin el recorte de `/demo`.
No queda registrada en `api_usage` (no es tráfico de producción). Limitada
a 120 requests/min por usuario.

### GET /api/geo/1/catalog

Catálogo público de metadatos. No requiere API key.

Devuelve dominios disponibles, conteos, versión activa y links a otros endpoints.

### GET /api/geo/1/catalog/coverage?lat=&lon=

Dry-run del query: qué capas y dominios cubren el punto, sin ejecutar queries externos.
Útil para exploración antes de consumir el query real.
No requiere API key.

## Caché TTL por frecuencia de actualización

| update_frequency | cache_ttl       |
|------------------|-----------------|
| not_planned      | 90 días         |
| annually         | 30 días         |
| quarterly        | 7 días          |
| biannually       | 7 días          |
| monthly          | 1 día           |
| fortnightly      | 1 día           |
| weekly           | 1 hora          |
| daily            | 1 hora          |
| irregular        | 6 horas         |
| unknown          | 6 horas         |
| continual        | sin caché       |

## Rate limiting

Cada API key tiene un límite de requests por minuto (60/min por default en
el piloto, configurable por key vía la columna `rate_limit` — sin UI en el
panel todavía). Al excederlo, la respuesta es:

Respuesta 429:
{ "error": "Límite de 60 requests/min excedido para esta key." }

Incluye el header `Retry-After` (segundos hasta que se libera cupo).

## Cadena de resolución entre capas

No implementado todavía. Cada capa se resuelve de forma independiente — no
hay forma hoy de que una capa use el resultado de otra como input (ej. una
capa de demografía que necesite el `municipality_id` que devuelve una capa
de municipios). Ver `docs/ROADMAP.md` → "Dependencias entre capas".

## Normalización de coordenadas

precision=3 (default) → redondea a 3 decimales ≈ 111m de precisión.
Esto permite cache hits cuando dos requests están dentro del mismo tile de 111m.
precision=8 → máxima precisión, sin beneficio de caché.
