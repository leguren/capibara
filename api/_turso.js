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
 *
 * Protocolo HTTP vs WebSocket:
 *   @libsql/client usa WebSocket (libsql://) por defecto, lo que requiere
 *   reconexión en cada cold start de Vercel. Para resultado sets grandes
 *   (100+ filas) la reconexión + transferencia supera el timeout de 10s.
 *   Forzamos HTTPS para usar Hrana HTTP, que es stateless y mucho más
 *   adecuado para funciones serverless.
 *   file: se preserva tal cual para desarrollo local.
 */

const { createClient } = require('@libsql/client');

let _client = null;

/**
 * toHttpUrl(url) → string
 *
 * Convierte libsql:// a https:// para forzar Hrana HTTP en serverless.
 * Deja file: intacto para desarrollo local con archivo SQLite.
 */
function toHttpUrl(url) {
  if (!url) return url;
  if (url.startsWith('libsql://')) return url.replace('libsql://', 'https://');
  return url;
}

function getDb() {
  if (!_client) {
    _client = createClient({
      url:       toHttpUrl(process.env.TURSO_URL),
      authToken: process.env.TURSO_AUTH_TOKEN || '',
    });
  }
  return _client;
}

module.exports = { getDb };
