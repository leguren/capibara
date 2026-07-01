/**
 * api/_db.js — Inicialización del schema y helpers de base de datos
 *
 * Usa execute() individual para cada statement (db.batch() no es
 * compatible con todos los planes de Turso), pero los dispara en
 * paralelo agrupados por fase (tablas, luego índices) en vez de
 * uno por uno con await secuencial — eso era lo que hacía tan lento
 * cada cold start (25 round-trips de red, uno atrás del otro).
 *
 * Además, antes de tocar nada, se hace 1 sola query para chequear si
 * el schema ya existe. En el 99% de los requests (deploy ya inicializado)
 * initSchema() termina en 1 round-trip en vez de 25.
 */

const { getDb } = require('./_turso');

let _schemaInitialized = false;

const TABLES = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    picture TEXT, role TEXT NOT NULL DEFAULT 'user', tier TEXT,
    created_at TEXT NOT NULL, last_login TEXT)`,

  `CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'rest', tier TEXT, rate_limit INTEGER,
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_used_at TEXT)`,

  `CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY, name_source TEXT, name_alias TEXT,
    provider_source TEXT, provider_alias TEXT,
    data_format TEXT NOT NULL, access_method TEXT NOT NULL DEFAULT 'url',
    connection_params TEXT NOT NULL DEFAULT '{}',
    included INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'unverified',
    last_checked TEXT, error_message TEXT, notes TEXT, created_at TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS source_countries (
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    country TEXT NOT NULL, PRIMARY KEY (source_id, country))`,

  `CREATE TABLE IF NOT EXISTS layers (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    name_source TEXT NOT NULL, name_alias TEXT, abstract TEXT, domain TEXT,
    update_frequency TEXT NOT NULL DEFAULT 'unknown',
    geometry_type TEXT NOT NULL DEFAULT 'UNKNOWN',
    srs TEXT NOT NULL DEFAULT 'EPSG:4326',
    feature_count INTEGER, min_lat REAL, max_lat REAL, min_lon REAL, max_lon REAL,
    included INTEGER NOT NULL DEFAULT 0,
    metadata TEXT NOT NULL DEFAULT '{}', notes TEXT, discovered_at TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS layer_dependencies (
    layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    depends_on_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    input_field TEXT NOT NULL, output_param TEXT NOT NULL,
    PRIMARY KEY (layer_id, depends_on_id))`,

  `CREATE TABLE IF NOT EXISTS fields (
    id TEXT PRIMARY KEY,
    layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL, name_source TEXT NOT NULL, name_alias TEXT,
    type TEXT NOT NULL DEFAULT 'unknown', included INTEGER NOT NULL DEFAULT 1,
    metadata TEXT NOT NULL DEFAULT '{}', notes TEXT, discovered_at TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS publications (
    id TEXT PRIMARY KEY,
    published_by TEXT NOT NULL REFERENCES users(id),
    version_label TEXT NOT NULL, config_json TEXT NOT NULL,
    sources_count INTEGER NOT NULL, layers_count INTEGER NOT NULL,
    fields_count INTEGER NOT NULL, notes TEXT, created_at TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS user_layer_prefs (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    layer_id TEXT NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
    included INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (user_id, layer_id))`,

  `CREATE TABLE IF NOT EXISTS user_field_prefs (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    field_id TEXT NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
    included INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (user_id, field_id))`,

  `CREATE TABLE IF NOT EXISTS api_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_id TEXT NOT NULL REFERENCES api_keys(id),
    endpoint TEXT NOT NULL, lat REAL, lon REAL,
    status_code INTEGER NOT NULL, response_ms INTEGER, requested_at TEXT NOT NULL)`,
];

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
  `CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_sources_status ON sources(status)`,
  `CREATE INDEX IF NOT EXISTS idx_sources_included ON sources(included)`,
  `CREATE INDEX IF NOT EXISTS idx_sources_format ON sources(data_format)`,
  `CREATE INDEX IF NOT EXISTS idx_source_countries_country ON source_countries(country)`,
  `CREATE INDEX IF NOT EXISTS idx_layers_source_id ON layers(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_layers_included ON layers(included)`,
  `CREATE INDEX IF NOT EXISTS idx_layers_domain ON layers(domain)`,
  `CREATE INDEX IF NOT EXISTS idx_layers_bbox ON layers(min_lat, max_lat, min_lon, max_lon)`,
  `CREATE INDEX IF NOT EXISTS idx_fields_layer_id ON fields(layer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_fields_source_id ON fields(source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_fields_included ON fields(included)`,
  `CREATE INDEX IF NOT EXISTS idx_publications_created_at ON publications(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_api_usage_key_id ON api_usage(key_id)`,
  `CREATE INDEX IF NOT EXISTS idx_api_usage_requested_at ON api_usage(requested_at DESC)`,
];

/**
 * schemaExists(db) → boolean
 *
 * 1 sola query liviana para saber si el schema ya fue creado alguna vez.
 * Evita pagar 25 round-trips en cada cold start cuando ya está creado
 * (que es el caso normal en producción, siempre después del primer deploy).
 */
async function schemaExists(db) {
  try {
    const result = await db.execute(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users' LIMIT 1`
    );
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

async function initSchema() {
  if (_schemaInitialized) return;

  const db = getDb();

  if (await schemaExists(db)) {
    _schemaInitialized = true;
    return;
  }

  // Primera vez que corre contra esta DB: crear todo.
  // Tablas en paralelo, después índices en paralelo (los índices
  // necesitan que su tabla exista, pero no dependen entre sí).
  await Promise.all(TABLES.map(sql => db.execute(sql)));
  await Promise.all(INDEXES.map(sql => db.execute(sql)));

  _schemaInitialized = true;
}

async function getLatestPublication(db) {
  const result = await db.execute(
    `SELECT id, version_label, config_json, sources_count, layers_count, fields_count, created_at
     FROM publications ORDER BY created_at DESC LIMIT 1`
  );
  if (!result.rows.length) return null;
  const row = result.rows[0];
  try {
    return { ...row, config: JSON.parse(row.config_json) };
  } catch {
    return null;
  }
}

function logUsage(data) {
  const db = getDb();
  db.execute({
    sql: `INSERT INTO api_usage (key_id, endpoint, lat, lon, status_code, response_ms, requested_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    args: [data.keyId, data.endpoint, data.lat || null, data.lon || null, data.statusCode, data.responseMs || null],
  }).catch(e => console.error('[_db] logUsage error:', e.message));
}

module.exports = { initSchema, getLatestPublication, logUsage };
