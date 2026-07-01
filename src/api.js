/**
 * src/api.js — Cliente HTTP del frontend
 *
 * window.CAPIBARA_API — IIFE que expone funciones de fetch contra la API propia.
 * Manejo uniforme de errores y parsing JSON.
 */

window.CAPIBARA_API = (() => {
  'use strict';

  const { API_BASE, ADMIN_API, USER_API, AUTH_API } = window.CAPIBARA_CONFIG;

  /**
   * request(path, options?) → Promise<{ data, ok, error }>
   *
   * Wrapper sobre fetch que siempre devuelve { data, ok, error }.
   * cache: 'no-store' — fuerza request real cada vez, evita 304/ETag del browser.
   * Nunca lanza — todos los errores se capturan y devuelven en .error.
   */
  async function request(path, options = {}) {
    try {
      const res = await fetch(path, {
        cache:   'no-store',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      let data;
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        data = await res.json();
      } else {
        data = { raw: await res.text() };
      }

      if (!res.ok) {
        return { data: null, ok: false, error: data?.error || `HTTP ${res.status}` };
      }

      return { data, ok: true, error: null };

    } catch (e) {
      return { data: null, ok: false, error: e.message };
    }
  }

  const get   = (path)       => request(path, { method: 'GET' });

  // Cache en memoria para getSources — evita re-fetchear toda la lista
  // cuando solo cambió una fuente. TTL de 30s. Se invalida explícitamente
  // al pasar invalidate=true (tras crear, eliminar o hacer cambios globales).
  let _sourcesCache     = null;
  let _sourcesCacheTime = 0;
  const SOURCES_TTL_MS  = 30_000;

  function cachedGetSources(invalidate = false) {
    if (!invalidate && _sourcesCache && (Date.now() - _sourcesCacheTime) < SOURCES_TTL_MS) {
      return Promise.resolve({ data: _sourcesCache, ok: true, error: null });
    }
    return get(`${ADMIN_API}/sources`).then(result => {
      if (result.ok) { _sourcesCache = result.data; _sourcesCacheTime = Date.now(); }
      return result;
    });
  }

  function invalidateSourcesCache() { _sourcesCache = null; }
  const post  = (path, body) => request(path, { method: 'POST', body });
  const patch = (path, body) => request(path, { method: 'PATCH', body });
  const del   = (path)       => request(path, { method: 'DELETE' });

  return {
    // Auth
    getMe:     () => get(`${AUTH_API}/me`),
    logout:    () => get(`${AUTH_API}/logout`),

    // Admin — Sources
    getSources:      (invalidate)  => cachedGetSources(invalidate),
    getSource:       (id)         => get(`${ADMIN_API}/sources?id=${id}`),
    createSource:    (body)       => post(`${ADMIN_API}/sources`, body),
    updateSource:    (id, body)   => patch(`${ADMIN_API}/sources?id=${id}`, body),
    deleteSource:    (id)         => del(`${ADMIN_API}/sources?id=${id}`),
    connectSource:   (id)         => post(`${ADMIN_API}/sources/connect?id=${id}`, {}),
    discoverLayers:  (id)         => post(`${ADMIN_API}/sources/discover?id=${id}`, {}),
    detectFormat:    (url)        => post(`${ADMIN_API}/detect`, { url }),

    // Admin — Layers
    getSourceLayers: (sourceId)    => get(`${ADMIN_API}/layers?source_id=${sourceId}`),
    updateLayer:     (id, body)   => patch(`${ADMIN_API}/layers?id=${id}`, body),
    getLayerFields:  (id)         => get(`${ADMIN_API}/layers/fields?id=${id}`),
    getLayerSample:  (id, count)  => get(`${ADMIN_API}/layers/sample?id=${id}${count ? `&count=${count}` : ''}`),
    discoverFields:  (id)         => post(`${ADMIN_API}/layers/discover?id=${id}`, {}),

    // Admin — Fields
    updateField:     (id, body)   => patch(`${ADMIN_API}/fields?id=${id}`, body),
    getFieldSample:  (id)         => get(`${ADMIN_API}/fields/sample?id=${id}`),

    // Admin — Publish
    getPublications:    ()     => get(`${ADMIN_API}/publish`),
    getPublication:     (id)   => get(`${ADMIN_API}/publish?id=${id}`),
    publish:            (body) => post(`${ADMIN_API}/publish`, body),
    deletePublication:  (id)   => del(`${ADMIN_API}/publish?id=${id}`),

    invalidateSourcesCache,

    // Admin — Stats, Analytics, Users, Keys
    getStats:        ()     => get(`${ADMIN_API}/stats`),
    getUsage:        (days) => get(`${ADMIN_API}/usage${days ? `?days=${days}` : ''}`),
    getAdminUsers:   ()     => get(`${ADMIN_API}/users`),
    getAdminKeys:    ()     => get(`${ADMIN_API}/admin-keys`),
    revokeAdminKey:  (id)   => del(`${ADMIN_API}/admin-keys?id=${id}`),

    // User
    getKeys:    ()         => get(`${USER_API}/keys`),
    createKey:  (body)     => post(`${USER_API}/keys`, body),
    updateKey:  (id, body) => patch(`${USER_API}/keys?id=${id}`, body),
    deleteKey:  (id)       => del(`${USER_API}/keys?id=${id}`),
  };
})();
