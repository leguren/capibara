/**
 * api/_utils.js — Utilidades compartidas del servidor
 *
 * El prefijo _ impide que Vercel lo exponga como endpoint HTTP.
 * Importado por todos los handlers que necesiten estas funciones.
 *
 * Contenido:
 *   id(prefix)     → genera un ID con 12 dígitos numéricos: 'src_847293019284'
 *   now()          → ISO 8601 UTC del momento actual
 *   ok(res, data)  → respuesta 200 JSON
 *   err(res, status, message) → respuesta de error JSON estandarizada
 *   safeJson(str)  → parsea JSON sin lanzar excepción
 *   requireFields(obj, fields) → valida campos requeridos en el body
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Generación de IDs
// ---------------------------------------------------------------------------

/**
 * id(prefix) → string
 *
 * Genera un ID con prefijo y 12 dígitos numéricos aleatorios seguros.
 * Ejemplos: id('src') → 'src_847293019284'
 *           id('lyr') → 'lyr_029384756102'
 *
 * Prefijos establecidos:
 *   'usr' → users
 *   'key' → api_keys
 *   'src' → sources
 *   'lyr' → layers
 *   'fld' → fields
 *   'pub' → publications
 */
function id(prefix) {
  // 12 dígitos decimales criptográficamente seguros
  const bytes  = crypto.randomBytes(12);
  const digits = Array.from(bytes, b => String(b % 10)).join('').slice(0, 12);
  return `${prefix}_${digits}`;
}

// ---------------------------------------------------------------------------
// Tiempo
// ---------------------------------------------------------------------------

/**
 * now() → string ISO 8601 UTC
 *
 * Todas las marcas de tiempo en la DB son ISO 8601 UTC.
 * Usar siempre esta función para garantizar consistencia de formato.
 */
function now() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Helpers de respuesta HTTP
// ---------------------------------------------------------------------------

/**
 * ok(res, data, status?) → void
 *
 * Respuesta exitosa JSON. Status por defecto 200.
 * Uso: return ok(res, { sources: [...] });
 *      return ok(res, { ok: true }, 201);
 */
function ok(res, data, status = 200) {
  return res.status(status).json(data);
}

/**
 * err(res, status, message) → void
 *
 * Respuesta de error JSON estandarizada.
 * Siempre { error: string } — nunca exponer stack traces en producción.
 * Uso: return err(res, 400, 'Se requiere url');
 *      return err(res, 404, 'Fuente no encontrada');
 */
function err(res, status, message) {
  return res.status(status).json({ error: message });
}

// ---------------------------------------------------------------------------
// Parseo seguro
// ---------------------------------------------------------------------------

/**
 * safeJson(str, fallback?) → object | fallback
 *
 * Parsea un string JSON sin lanzar excepción.
 * Si el string es inválido, devuelve el fallback (por defecto null).
 * Usar para leer campos JSON de la DB (connection_params, metadata).
 */
function safeJson(str, fallback = null) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Validación de body
// ---------------------------------------------------------------------------

/**
 * requireFields(obj, fields) → string | null
 *
 * Verifica que todos los campos requeridos estén presentes y no vacíos.
 * Devuelve el nombre del primer campo faltante, o null si todos están.
 *
 * Uso:
 *   const missing = requireFields(req.body, ['url', 'data_format']);
 *   if (missing) return err(res, 400, `Se requiere: ${missing}`);
 */
function requireFields(obj, fields) {
  for (const field of fields) {
    const val = obj?.[field];
    if (val === undefined || val === null || val === '') return field;
  }
  return null;
}

module.exports = { id, now, ok, err, safeJson, requireFields };
