/**
 * api/_utils.js — Utilidades compartidas del servidor
 *
 * El prefijo _ impide que Vercel lo exponga como endpoint HTTP.
 * Importado por todos los handlers que necesiten estas funciones.
 *
 * Contenido:
 *   id(prefix)     → genera un ID con nanoid: 'src_xK9mZ3...'
 *   now()          → ISO 8601 UTC del momento actual
 *   ok(res, data)  → respuesta 200 JSON
 *   err(res, status, message) → respuesta de error JSON estandarizada
 *   safeJson(str)  → parsea JSON sin lanzar excepción
 *   requireBody(req, res, fields) → valida campos requeridos en el body
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Generación de IDs
// ---------------------------------------------------------------------------

/**
 * NANOID_ALPHABET — alfabeto URL-safe sin caracteres ambiguos.
 * Excluye: 0, O (confundibles), I, l (confundibles en tipografías).
 * 62 caracteres → ~7.2 bits de entropía por carácter.
 * Con 12 caracteres: ~86 bits de entropía → colisiones negligibles.
 */
const NANOID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz123456789';

/**
 * nanoid(size) → string
 *
 * Genera un string aleatorio criptográficamente seguro.
 * Usa crypto.getRandomValues() (disponible en Node 15+).
 */
function nanoid(size = 12) {
  const bytes  = crypto.randomBytes(size);
  const result = [];
  for (let i = 0; i < size; i++) {
    result.push(NANOID_ALPHABET[bytes[i] % NANOID_ALPHABET.length]);
  }
  return result.join('');
}

/**
 * id(prefix) → string
 *
 * Genera un ID con prefijo para identificar la entidad en logs y URLs.
 * Ejemplos: id('src') → 'src_xK9mZ3YqWp2B'
 *           id('lyr') → 'lyr_AbC3dEfGhJ4K'
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
  return `${prefix}_${nanoid(12)}`;
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
