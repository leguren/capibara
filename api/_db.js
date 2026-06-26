/**
 * api/_db.js — Inicialización del schema y helpers de base de datos
 *
 * El prefijo _ impide que Vercel lo exponga como endpoint HTTP.
 * Importado por los handlers que necesiten inicializar el schema o
 * usar helpers de query.
 *
 * initSchema() → crea todas las tablas si no existen.
 *   Se llama en el primer request de cualquier handler de la API.
 *   Es idempotente: usa CREATE TABLE IF NOT EXISTS.
 *   En Vercel serverless, múltiples instancias pueden llamarlo en paralelo
 *   sin problema porque SQLite maneja el CREATE IF NOT EXISTS atómicamente.
 *
 * Helpers:
 *   getLatestPublication(db) → la última publicación activa o null
 *   logUsage(db, data)       → inserta un registro en api_usage (fire & forget)
 */

const fs     = require('fs');
const path   = require('path');
const { getDb } = require('./_turso');

// ---------------------------------------------------------------------------
// Schema initialization
// ---------------------------------------------------------------------------

let _schemaInitialized = false;

/**
 * initSchema() → Promise<void>
 *
 * Lee y ejecuta migrations/001_initial.sql contra la DB.
 * Solo se ejecuta una vez por proceso (variable _schemaInitialized).
 * El SQL usa CREATE TABLE IF NOT EXISTS, por lo que es seguro en cold starts
 * de múltiples instancias simultáneas.
 */
async function initSchema() {
  if (_schemaInitialized) return;

  const db = getDb();

  // Lee el archivo de migraciones relativo a la raíz del proyecto
  const sqlPath = path.join(process.cwd(), 'migrations', '001_initial.sql');
  const sql     = fs.readFileSync(sqlPath, 'utf8');

  // Ejecuta cada statement separado por punto y coma
  // (Turso/libSQL no soporta múltiples statements en un solo execute)
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const stmt of statements) {
    await db.execute(stmt);
  }

  _schemaInitialized = true;
}

// ---------------------------------------------------------------------------
// Helpers de query
// ---------------------------------------------------------------------------

/**
 * getLatestPublication(db) → object | null
 *
 * Devuelve la última publicación (por created_at DESC) con el config_json
 * parseado. La API pública /api/geo/1/query la usa para saber qué capas
 * y fuentes están activas en este momento.
 *
 * Devuelve null si nunca se publicó.
 */
async function getLatestPublication(db) {
  const result = await db.execute(
    `SELECT id, version_label, config_json, sources_count, layers_count, fields_count, created_at
     FROM publications
     ORDER BY created_at DESC
     LIMIT 1`
  );

  if (!result.rows.length) return null;

  const row = result.rows[0];
  try {
    return {
      ...row,
      config: JSON.parse(row.config_json),
    };
  } catch {
    return null;
  }
}

/**
 * logUsage(data) → void (fire & forget)
 *
 * Inserta un registro en api_usage sin bloquear la respuesta.
 * Si falla, solo loguea el error — nunca debe romper un request.
 *
 * data: { keyId, endpoint, lat?, lon?, statusCode, responseMs? }
 */
function logUsage(data) {
  const db = getDb();
  db.execute({
    sql: `INSERT INTO api_usage (key_id, endpoint, lat, lon, status_code, response_ms, requested_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    args: [
      data.keyId,
      data.endpoint,
      data.lat    || null,
      data.lon    || null,
      data.statusCode,
      data.responseMs || null,
    ],
  }).catch(e => console.error('[_db] logUsage error:', e.message));
}

module.exports = { initSchema, getLatestPublication, logUsage };
