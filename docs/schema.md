# docs/schema.md — Schema de base de datos

## Tablas

### users
Identidad de todos los humanos. Autenticación exclusivamente por Google OAuth.

| Campo      | Tipo | Notas                            |
|------------|------|----------------------------------|
| id         | TEXT | PK. Formato: usr_{nanoid(12)}    |
| email      | TEXT | UNIQUE. Email de Google          |
| name       | TEXT | Nombre completo de Google        |
| picture    | TEXT | URL del avatar de Google         |
| role       | TEXT | 'admin' o 'user'                 |
| tier       | TEXT | NULL hasta asignar plan          |
| created_at | TEXT | ISO 8601 UTC                     |
| last_login | TEXT | ISO 8601 UTC, actualizado en cada login |

### api_keys
Credenciales B2B. El token real nunca se almacena — solo su SHA-256.

| Campo       | Tipo    | Notas                                    |
|-------------|---------|------------------------------------------|
| id          | TEXT    | PK. Formato: key_{nanoid(12)}            |
| user_id     | TEXT    | FK → users.id ON DELETE CASCADE          |
| label       | TEXT    | Nombre descriptivo del usuario           |
| key_hash    | TEXT    | SHA-256 del token. UNIQUE                |
| type        | TEXT    | 'rest' (único tipo soportado hoy — ver ROADMAP.md) |
| tier        | TEXT    | Override del tier del usuario (NULL = hereda) |
| rate_limit  | INTEGER | Requests/min. NULL = usa el default del piloto (ver api/geo/query.js) |
| active      | INTEGER | 1 activa, 0 inactiva                     |
| created_at  | TEXT    | ISO 8601 UTC                             |
| last_used_at| TEXT    | Actualizado en cada request autenticado  |

### sources
Servicios externos de datos geoespaciales.

| Campo             | Tipo | Notas                                              |
|-------------------|------|----------------------------------------------------|
| id                | TEXT | PK. Formato: src_{nanoid(12)}                      |
| name_source       | TEXT | Nombre del servicio externo. NULL hasta connect()  |
| name_alias        | TEXT | Alias manual del admin                             |
| provider_source   | TEXT | Proveedor auto-detectado. NULL hasta connect()     |
| provider_alias    | TEXT | Proveedor manual                                   |
| data_format       | TEXT | 'wfs', 'arcgis_rest', 'csv', 'geojson', 'json'    |
| access_method     | TEXT | 'url' o 'file'                                     |
| connection_params | TEXT | JSON: { url, version, auth_type, auth_value }      |
| included          | INT  | 0/1 — interruptor global de la fuente              |
| status            | TEXT | 'unverified', 'ok', 'degraded', 'error', 'deprecated' |
| last_checked      | TEXT | ISO 8601 UTC del último connect()                  |
| error_message     | TEXT | Mensaje del último error                           |
| notes             | TEXT | Notas internas del admin                           |

### source_countries
Cobertura geográfica por país.

| Campo     | Tipo | Notas                              |
|-----------|------|------------------------------------|
| source_id | TEXT | FK → sources.id ON DELETE CASCADE  |
| country   | TEXT | Código ISO 3166-1 alpha-2 o libre  |

PK compuesto (source_id, country).

### layers
Capas descubiertas dentro de cada fuente.

| Campo           | Tipo | Notas                                          |
|-----------------|------|------------------------------------------------|
| id              | TEXT | PK. Formato: lyr_{nanoid(12)}                  |
| source_id       | TEXT | FK → sources.id ON DELETE CASCADE              |
| name_source     | TEXT | Nombre técnico de la capa en la fuente         |
| name_alias      | TEXT | Nombre legible                                 |
| abstract        | TEXT | Descripción OGC del servicio                   |
| domain          | TEXT | Uno de los 20 dominios de Capibara             |
| update_frequency| TEXT | ISO 19115 MD_MaintenanceFrequencyCode          |
| geometry_type   | TEXT | 'POINT', 'LINE', 'POLYGON', 'GEOMETRY', 'UNKNOWN' |
| srs             | TEXT | Sistema de referencia. Default: 'EPSG:4326'    |
| feature_count   | INT  | NULL si la fuente no soporta hits count        |
| min_lat         | REAL | Bounding box — queryable por coordenada        |
| max_lat         | REAL |                                                |
| min_lon         | REAL |                                                |
| max_lon         | REAL |                                                |
| included        | INT  | DEFAULT 0 — opt-in consciente del admin        |
| metadata        | TEXT | JSON: { cache_ttl_seconds, group, ... }        |
| notes           | TEXT | Notas internas del admin                       |
| discovered_at   | TEXT | ISO 8601 UTC del último discover               |

> Nota: existió una tabla `layer_dependencies` (cadena de resolución entre
> capas, donde una capa podía depender del resultado de otra) pero nunca
> tuvo UI ni endpoint para poblarla — se sacó del schema. La idea sigue
> documentada en `ROADMAP.md` por si en el futuro hay un caso de uso
> concreto que la necesite.

### fields
Campos descubiertos dentro de cada capa.

| Campo       | Tipo | Notas                                              |
|-------------|------|----------------------------------------------------|
| id          | TEXT | PK. Formato: fld_{nanoid(12)}                      |
| layer_id    | TEXT | FK → layers.id ON DELETE CASCADE                   |
| source_id   | TEXT | Desnormalizado para evitar JOIN doble              |
| name_source | TEXT | Nombre técnico original                            |
| name_alias  | TEXT | Alias legible (tarea de normalización pendiente)   |
| type        | TEXT | 'string', 'integer', 'float', 'boolean', 'geometry', 'unknown' |
| included    | INT  | DEFAULT 1                                          |
| metadata    | TEXT | JSON: { data_type, sample_value, nullable, has_html, is_geometry } |
| notes       | TEXT | Notas internas del admin                                           |
| discovered_at| TEXT | ISO 8601 UTC del último discover                                  |

data_type en metadata.metadata: 'discrete', 'census', 'normative', 'attribute',
'geophysical', 'index', 'event', 'time_series', 'realtime', 'forecast', 'proximity'.

### publications
Historial inmutable de publicaciones de la configuración pública.

| Campo         | Tipo | Notas                                     |
|---------------|------|-------------------------------------------|
| id            | TEXT | PK. Formato: pub_{nanoid(12)}             |
| published_by  | TEXT | FK → users.id                             |
| version_label | TEXT | 'v1.0.0', 'v1.0.1', ...                  |
| config_json   | TEXT | Snapshot completo SIN credenciales        |
| sources_count | INT  |                                           |
| layers_count  | INT  |                                           |
| fields_count  | INT  |                                           |
| notes         | TEXT | Nota de la publicación                    |
| created_at    | TEXT | ISO 8601 UTC                              |

### user_layer_prefs / user_field_prefs
Personalización por usuario. Solo guardan exclusiones explícitas.
Un usuario puede excluir capas/campos que el admin habilitó.
Un usuario NO puede activar capas/campos que el admin deshabilitó.

### api_usage
Log append-only. INTEGER AUTOINCREMENT (única tabla justificada).

### rate_limit_hits
Usada por `api/_ratelimit.js` para el rate limiting de `/api/geo/1/query`,
`/demo` y `/preview`. `bucket` identifica a quién se limita (`key:<id>`,
`demo_ip:<ip>` o `preview_user:<id>`) — sin FK a propósito, para poder
limitar también por IP sin una key asociada. Se auto-limpia: cada chequeo
borra los hits vencidos de ese bucket antes de contar, así que no necesita
un cron de mantenimiento aparte.
