/**
 * config/app.js — Configuración del frontend
 *
 * window.CAPIBARA_CONFIG — IIFE con constantes de la app.
 * Importar en todas las páginas antes que cualquier otro src/.
 */

window.CAPIBARA_CONFIG = (() => {
  'use strict';

  const API_BASE = '/api';

  return {
    API_BASE,
    GEO_API:    `${API_BASE}/geo/1`,
    ADMIN_API:  `${API_BASE}/admin`,
    USER_API:   `${API_BASE}/user`,
    AUTH_API:   `${API_BASE}/auth`,

    // Número máximo de API keys por usuario
    MAX_KEYS: 10,

    // Versión del catálogo — indica la version del config activo
    CATALOG_VERSION: '1',
  };
})();
