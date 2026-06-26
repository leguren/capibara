/**
 * api/_turso.js — Cliente Turso/libSQL compartido
 *
 * El prefijo _ impide que Vercel lo exponga como endpoint HTTP.
 * Importado por todos los handlers que necesiten acceso a la base de datos.
 *
 * Singleton: una sola instancia del cliente por proceso serverless.
 * En Vercel, cada función puede tener su propio proceso — el singleton
 * evita crear múltiples conexiones dentro de una misma invocación.
 *
 * Variables de entorno requeridas:
 *   TURSO_URL        → libsql://capibara-xxx.turso.io (producción)
 *                      file:local.db (desarrollo local)
 *   TURSO_AUTH_TOKEN → token de Turso (vacío en desarrollo local con file:)
 */

const { createClient } = require('@libsql/client');

let _client = null;

function getDb() {
  if (!_client) {
    _client = createClient({
      url:       process.env.TURSO_URL,
      authToken: process.env.TURSO_AUTH_TOKEN || '',
    });
  }
  return _client;
}

module.exports = { getDb };
