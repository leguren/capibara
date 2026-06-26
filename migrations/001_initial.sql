-- =============================================================================
-- migrations/001_initial.sql — Schema inicial de Capibara
--
-- Ejecutar una sola vez contra la base de datos Turso.
-- El cliente _db.js verifica si las tablas existen antes de crear,
-- por lo que este archivo es idempotente.
--
-- Orden de creación respeta dependencias de FK:
--   users → api_keys → api_usage
--   sources → source_countries
--   sources → layers → fields
--   layers → layer_dependencies
--   users → publications
--   users + layers → user_layer_prefs
--   users + fields → user_field_prefs
-- =============================================================================


-- -----------------------------------------------------------------------------
-- users
-- Identidad de todos los humanos del sistema: admins, usuarios y clientes.
-- Autenticación exclusivamente por Google OAuth.
-- role  → controla acceso al panel admin ('admin' | 'user')
-- tier  → controla qué sirve la API pública. NULL = sin plan asignado aún.
--         Valores futuros de ejemplo: 'free' | 'pro' | 'enterprise'
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,          -- 'usr_{nanoid(12)}'
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  picture     TEXT,                      -- URL del avatar de Google
  role        TEXT NOT NULL DEFAULT 'user',   -- 'admin' | 'user'
  tier        TEXT,                      -- NULL hasta que se asigne un plan
  created_at  TEXT NOT NULL,
  last_login  TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role);


-- -----------------------------------------------------------------------------
-- api_keys
-- Credenciales de acceso a /api/geo/1/* y /api/mcp.
-- El token real se muestra una sola vez al usuario y nunca se almacena.
-- Solo se guarda key_hash (SHA-256 del token) para verificación.
-- type → 'rest' para clientes HTTP estándar, 'mcp' para agentes IA
-- tier → override del tier del usuario para esta key específica (NULL = hereda)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,         -- 'key_{nanoid(12)}'
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,            -- nombre descriptivo del usuario: "Mi app", "Producción"
  key_hash     TEXT NOT NULL UNIQUE,     -- SHA-256 del token. Nunca el token en claro
  type         TEXT NOT NULL DEFAULT 'rest',   -- 'rest' | 'mcp'
  tier         TEXT,                     -- override de tier. NULL = hereda de users.tier
  rate_limit   INTEGER,                  -- requests/día. NULL = sin límite
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id  ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash);


-- -----------------------------------------------------------------------------
-- sources
-- Registro de servicios de datos geoespaciales externos.
-- name_source   → nombre que devuelve el servicio. NULL hasta que connect() corra.
-- name_alias    → nombre manual del admin. Si NULL, se muestra name_source en el panel.
-- provider_source → proveedor auto-detectado del servicio (ej: "IGN", "MMA")
-- provider_alias  → proveedor manual si el auto-detectado es incorrecto o nulo
-- connection_params → JSON stringificado con url, version, auth_type, auth_value, etc.
--                     auth_value NUNCA se incluye en el output del /api/publish
-- status → 'unverified' | 'ok' | 'degraded' | 'error' | 'deprecated'
--          'degraded': conecta pero con errores parciales (timeout en algunas capas)
-- included → interruptor global (0/1). Si 0, ninguna capa de esta fuente se sirve.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sources (
  id                TEXT PRIMARY KEY,    -- 'src_{nanoid(12)}'
  name_source       TEXT,               -- NULL hasta primer connect()
  name_alias        TEXT,
  provider_source   TEXT,               -- NULL hasta primer connect()
  provider_alias    TEXT,
  data_format       TEXT NOT NULL,      -- 'wfs' | 'arcgis_rest' | 'csv' | 'geojson' | 'json'
  access_method     TEXT NOT NULL DEFAULT 'url',  -- 'url' | 'file'
  connection_params TEXT NOT NULL DEFAULT '{}',
  included          INTEGER NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'unverified',
  last_checked      TEXT,
  error_message     TEXT,
  notes             TEXT,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sources_status   ON sources(status);
CREATE INDEX IF NOT EXISTS idx_sources_included ON sources(included);
CREATE INDEX IF NOT EXISTS idx_sources_format   ON sources(data_format);


-- -----------------------------------------------------------------------------
-- source_countries
-- Relación N:N entre fuentes y países de cobertura.
-- country → código ISO 3166-1 alpha-2 o valor libre: 'AR', 'CL', 'GLOBAL', 'LATAM'
-- Permite queries como: SELECT * FROM source_countries WHERE country = 'AR'
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS source_countries (
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  country   TEXT NOT NULL,
  PRIMARY KEY (source_id, country)
);

CREATE INDEX IF NOT EXISTS idx_source_countries_country ON source_countries(country);


-- -----------------------------------------------------------------------------
-- layers
-- Capas descubiertas dentro de cada fuente.
-- name_source  → nombre técnico de la capa en la fuente (ej: 'ign:provincia', '0')
-- name_alias   → nombre legible si la fuente lo provee o el admin lo setea manualmente
-- abstract     → descripción OGC del servicio. Columna directa (no en JSON) porque
--               se muestra en el panel y en el catálogo público.
-- domain       → uno de los 20 dominios de Capibara. Columna directa porque es el
--               filtro central del producto (?domain=geo,environment).
-- update_frequency → ISO 19115 MD_MaintenanceFrequencyCode. Determina el TTL de caché.
-- min/max lat/lon  → bounding box como columnas directas — son el filtro de la query
--                   central: qué capas cubren el punto consultado.
-- included     → DEFAULT 0: opt-in consciente. El admin activa explícitamente cada capa.
-- metadata     → JSON para info específica del formato no queryable:
--               { "cache_ttl_seconds": 0, "group": "administrativo", ... }
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS layers (
  id              TEXT PRIMARY KEY,      -- 'lyr_{nanoid(12)}'
  source_id       TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  name_source     TEXT NOT NULL,         -- nombre técnico crudo de la fuente
  name_alias      TEXT,
  abstract        TEXT,
  domain          TEXT,                  -- 'geo' | 'environment' | 'climate' | ... (20 dominios)
  update_frequency TEXT NOT NULL DEFAULT 'unknown',  -- ISO 19115 MD_MaintenanceFrequencyCode
  geometry_type   TEXT NOT NULL DEFAULT 'UNKNOWN',   -- 'POINT' | 'POLYGON' | 'LINESTRING' | etc.
  srs             TEXT NOT NULL DEFAULT 'EPSG:4326',
  feature_count   INTEGER,               -- NULL si la fuente no soporta hits count
  min_lat         REAL,                  -- bbox — queryable para filtro por coordenada
  max_lat         REAL,
  min_lon         REAL,
  max_lon         REAL,
  included        INTEGER NOT NULL DEFAULT 0,   -- opt-in: el admin activa explícitamente
  metadata        TEXT NOT NULL DEFAULT '{}',
  notes           TEXT,
  discovered_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_layers_source_id  ON layers(source_id);
CREATE INDEX IF NOT EXISTS idx_layers_included   ON layers(included);
CREATE INDEX IF NOT EXISTS idx_layers_domain     ON layers(domain);
CREATE INDEX IF NOT EXISTS idx_layers_bbox       ON layers(min_lat, max_lat, min_lon, max_lon);
CREATE INDEX IF NOT EXISTS idx_layers_frequency  ON layers(update_frequency);


-- -----------------------------------------------------------------------------
-- layer_dependencies
-- Cadena de resolución entre capas.
-- Una capa puede depender del resultado de otra: el output de la capa padre
-- alimenta como parámetro el query de la capa hija.
-- Ejemplo: Municipality layer → { municipality_id: "060784" }
--          Demographics layer usa municipality_id para filtrar, no geometría.
-- input_field  → nombre del campo en la respuesta de la capa padre
-- output_param → nombre del parámetro que la capa hija recibe
-- El algoritmo de resolución detecta ciclos antes de ejecutar.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS layer_dependencies (
  layer_id      TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
  depends_on_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
  input_field   TEXT NOT NULL,    -- campo del padre que se usa como input
  output_param  TEXT NOT NULL,    -- parámetro que recibe la capa hija
  PRIMARY KEY (layer_id, depends_on_id)
);

CREATE INDEX IF NOT EXISTS idx_layer_deps_layer_id     ON layer_dependencies(layer_id);
CREATE INDEX IF NOT EXISTS idx_layer_deps_depends_on   ON layer_dependencies(depends_on_id);


-- -----------------------------------------------------------------------------
-- fields
-- Campos descubiertos dentro de cada capa.
-- source_id    → desnormalizado para evitar JOIN doble en queries frecuentes
-- name_source  → nombre técnico original del campo (ej: 'cod_prov', 'nomprov')
-- name_alias   → alias legible. Es la tarea de normalización pendiente:
--               cuando name_alias IS NULL AND included = 1, el campo necesita
--               ser traducido. Asistible con IA usando el contexto de la capa
--               y el sample_value del metadata.
-- type         → columna directa porque se muestra en cada fila del panel.
--               'string' | 'integer' | 'float' | 'boolean' | 'geometry' | 'unknown'
-- metadata     → JSON: { "data_type": "discrete", "sample_value": "...",
--                        "nullable": true, "has_html": false, "is_geometry": false }
--               data_type: 'discrete' | 'census' | 'normative' | 'attribute' |
--                          'geophysical' | 'index' | 'event' | 'time_series' |
--                          'realtime' | 'forecast' | 'proximity' | 'network'
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fields (
  id            TEXT PRIMARY KEY,        -- 'fld_{nanoid(12)}'
  layer_id      TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
  source_id     TEXT NOT NULL,           -- desnormalizado: sources.id
  name_source   TEXT NOT NULL,           -- nombre técnico original
  name_alias    TEXT,                    -- alias legible — tarea de normalización pendiente
  type          TEXT NOT NULL DEFAULT 'unknown',
  included      INTEGER NOT NULL DEFAULT 1,
  metadata      TEXT NOT NULL DEFAULT '{}',
  notes         TEXT,
  discovered_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fields_layer_id   ON fields(layer_id);
CREATE INDEX IF NOT EXISTS idx_fields_source_id  ON fields(source_id);
CREATE INDEX IF NOT EXISTS idx_fields_included   ON fields(included);
CREATE INDEX IF NOT EXISTS idx_fields_alias_null ON fields(name_alias) WHERE name_alias IS NULL;


-- -----------------------------------------------------------------------------
-- publications
-- Historial inmutable de publicaciones de la configuración pública.
-- Cada publicación es un snapshot completo del estado de fuentes/capas/campos
-- activos en ese momento. La API pública lee la última publicación.
-- config_json  → JSON completo SIN credenciales (auth_value eliminado antes de guardar)
-- published_by → FK a users — audit trail obligatorio
-- version_label → controlado por la app: 'v1.0.0', 'v1.0.1', etc.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS publications (
  id               TEXT PRIMARY KEY,     -- 'pub_{nanoid(12)}'
  published_by     TEXT NOT NULL REFERENCES users(id),
  version_label    TEXT NOT NULL,
  config_json      TEXT NOT NULL,
  sources_count    INTEGER NOT NULL,
  layers_count     INTEGER NOT NULL,
  fields_count     INTEGER NOT NULL,
  notes            TEXT,
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_publications_created_at ON publications(created_at DESC);


-- -----------------------------------------------------------------------------
-- user_layer_prefs
-- Personalización por usuario de qué capas quiere en su API.
-- Un usuario puede EXCLUIR capas que el admin habilitó globalmente.
-- Un usuario NO puede ACTIVAR capas que el admin deshabilitó (layers.included = 0).
-- Solo existen filas para las exclusiones explícitas del usuario.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_layer_prefs (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
  included INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, layer_id)
);

CREATE INDEX IF NOT EXISTS idx_user_layer_prefs_user_id ON user_layer_prefs(user_id);


-- -----------------------------------------------------------------------------
-- user_field_prefs
-- Personalización por usuario de qué campos quiere en su API.
-- Misma lógica que user_layer_prefs: solo puede excluir, no activar.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_field_prefs (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  included INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_user_field_prefs_user_id ON user_field_prefs(user_id);


-- -----------------------------------------------------------------------------
-- api_usage
-- Log append-only de cada request a la API pública (/api/geo/1/* y /api/mcp).
-- Usos: rate limiting, billing, analytics de coordenadas más consultadas.
-- id → INTEGER AUTOINCREMENT: única tabla justificada para este tipo.
--      Es log puro: nadie referencia un registro individual, se inserta miles
--      de veces por día, y el rowid nativo de SQLite es exactamente esto.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_usage (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id        TEXT NOT NULL REFERENCES api_keys(id),
  endpoint      TEXT NOT NULL,           -- '/api/geo/1/query'
  lat           REAL,
  lon           REAL,
  status_code   INTEGER NOT NULL,
  response_ms   INTEGER,
  requested_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_usage_key_id       ON api_usage(key_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_requested_at ON api_usage(requested_at DESC);
