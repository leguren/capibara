/**
 * api/_connectors/_interface.js — Interfaz y factory de conectores
 *
 * Define el contrato que todo conector debe implementar.
 * makeConnector(impl) valida que la implementación cumpla la interfaz
 * y agrega manejo de errores uniforme para getSample y getFeatureAtPoint.
 *
 * Interfaz obligatoria:
 *   connect(params)                         → { ok, error?, info? }
 *   getLayers(params)                       → [{ name, title, metadata }]
 *   getFields(params, layerName)            → [{ name, metadata }]
 *   getSample(params, layerName, count?)    → { features, total }
 *   getFeatureAtPoint(params, layerName, lat, lon) → { feature, error? }
 *
 * Interfaz opcional:
 *   getCount(params, layerName)             → number | null
 *
 * Todos los métodos:
 *   - Reciben `params` que es el objeto parseado de sources.connection_params
 *   - connect() NUNCA lanza — siempre devuelve { ok: false, error: msg }
 *   - getLayers/getFields/getSample/getFeatureAtPoint SÍ pueden lanzar
 *     (el handler los envuelve en try/catch)
 */

const REQUIRED_METHODS = ['connect', 'getLayers', 'getFields', 'getSample', 'getFeatureAtPoint'];

/**
 * makeConnector(impl) → connector
 *
 * Factory que:
 *   1. Verifica que la implementación tenga todos los métodos requeridos
 *   2. Garantiza que connect() nunca lance una excepción no capturada
 *   3. Devuelve el objeto conector listo para registrar en _registry.js
 *
 * Uso en cada conector:
 *   const { makeConnector } = require('./_interface');
 *   module.exports = makeConnector({ connect, getLayers, getFields, getSample, getFeatureAtPoint });
 */
function makeConnector(impl) {
  // Verificar métodos requeridos
  for (const method of REQUIRED_METHODS) {
    if (typeof impl[method] !== 'function') {
      throw new Error(`[connector] Falta implementar: ${method}()`);
    }
  }

  // Envolver connect() para garantizar que nunca lanza
  const originalConnect = impl.connect;
  impl.connect = async function(params) {
    try {
      return await originalConnect.call(this, params);
    } catch (e) {
      return { ok: false, error: e.message || 'Error desconocido en connect()' };
    }
  };

  return impl;
}

module.exports = { makeConnector };
