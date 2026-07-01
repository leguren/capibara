/**
 * src/sources.js — Módulo principal del panel admin de fuentes
 *
 * window.CAPIBARA_SOURCES — gestión de fuentes en el panel admin.
 * Coordina: listado, creación con auto-cascade, conexión, descubrimiento y eliminación.
 */

window.CAPIBARA_SOURCES = (() => {
  'use strict';

  const API    = window.CAPIBARA_API;
  const TOAST  = window.CAPIBARA_TOAST;
  const UTILS  = window.CAPIBARA_UTILS;
  const FMTS   = window.CAPIBARA_FORMATS;

  let _sources  = [];
  let _onUpdate = null;

  // ── Listado ──────────────────────────────────────────────────────────────

  async function load() {
    const { data, ok, error } = await API.getSources();
    if (!ok) { TOAST.error('Error al cargar fuentes', error); return; }
    _sources = data.sources || [];
    if (_onUpdate) _onUpdate(_sources);
    return _sources;
  }

  function onUpdate(fn) { _onUpdate = fn; }

  // ── Creación con cascade automático ──────────────────────────────────────

  /**
   * openCreateModal() → void
   *
   * Modal de nueva fuente en dos estados:
   *   Estado 1 — solo URL + botón Detectar.
   *   Estado 2 — campos dinámicos según el formato detectado.
   *
   * El modal es dinámico: cada formato muestra sus propios campos específicos.
   * Actualmente implementado para WFS. Los demás están pendientes (ver TODOs).
   *
   * Flujo: crear fuente → auto-conectar → auto-descubrir capas.
   */
  function openCreateModal() {
    const COUNTRIES = window.CAPIBARA_COUNTRIES;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <div class="modal-title">Nueva fuente</div>
          <button class="modal-close" id="modal-close">
            <span class="material-symbols-outlined" style="font-size:18px;line-height:1">close</span>
          </button>
        </div>
        <div class="modal-body">
          <div class="modal-field">
            <label class="modal-label">URL</label>
            <!-- TODO: agregar opción de archivo adjunto (access_method: 'file') -->
            <div style="display:flex;gap:8px">
              <input class="input" id="src-url" placeholder="https://..." style="flex:1">
              <button class="action-btn" id="btn-detect">Detectar</button>
            </div>
          </div>
          <div id="src-dynamic-fields"></div>
        </div>
        <div class="modal-footer">
          <button class="action-btn" id="modal-cancel">Cancelar</button>
          <button class="action-btn primary" id="modal-save" style="display:none">Conectar</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#modal-close').addEventListener('click', close);
    overlay.querySelector('#modal-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    // ── Helpers de renderizado ─────────────────────────────────────────────

    // Genera las <option> del selector de países desde el vocab global
    function countriesHTML() {
      return COUNTRIES.LIST
        .map(c => `<option value="${c.code}">${c.name} ${c.code}</option>`)
        .join('');
    }

    // Campos comunes a todos los formatos soportados:
    // nombre (readonly, auto-detectado), alias, proveedor (readonly), alias proveedor, países, notas.
    // preview: { name_source, provider_source } — puede ser null si el servicio no informa.
    function commonFieldsHTML(preview = {}) {
      const namePH     = preview.name_source     ? '' : '(el servicio no informa nombre)';
      const providerPH = preview.provider_source ? '' : '(el servicio no informa proveedor)';
      return `
        <div class="modal-field">
          <label class="modal-label">Nombre del servicio</label>
          <input class="input" id="src-name-source" readonly
            value="${UTILS.escHtml(preview.name_source || '')}"
            placeholder="${namePH}">
        </div>
        <div class="modal-field">
          <label class="modal-label">Alias</label>
          <input class="input" id="src-alias" placeholder="Nombre legible">
        </div>
        <div class="modal-field">
          <label class="modal-label">Proveedor del servicio</label>
          <input class="input" id="src-provider-source" readonly
            value="${UTILS.escHtml(preview.provider_source || '')}"
            placeholder="${providerPH}">
        </div>
        <div class="modal-field">
          <label class="modal-label">Alias</label>
          <input class="input" id="src-provider" placeholder="Nombre legible del proveedor">
        </div>
        <div class="modal-field">
          <label class="modal-label">Países</label>
          <select class="select" id="src-countries" multiple style="height:60px">
            ${countriesHTML()}
          </select>
        </div>
        <div class="modal-field">
          <label class="modal-label">Notas internas</label>
          <textarea class="textarea" id="src-notes" style="height:72px;padding:8px 12px"></textarea>
        </div>
      `;
    }

    // ── Campos específicos por formato ─────────────────────────────────────

    // WFS: formato (readonly) + versión (readonly si fue detectada, select si no).
    function wfsFieldsHTML(preview, detectedParams) {
      const v = detectedParams.version || '';
      const versionField = v
        ? `<input class="input" id="src-wfs-version" value="${v}" readonly>`
        : `<div class="dd-wrap">
             <select class="select" id="src-wfs-version">
               <option value="1.0.0">1.0.0</option>
               <option value="1.1.0" selected>1.1.0</option>
               <option value="2.0.0">2.0.0</option>
             </select>
             <span class="dd-icon">expand_more</span>
           </div>`;
      return `
        <div class="modal-field">
          <label class="modal-label">Formato</label>
          <input class="input" value="${FMTS.get('wfs').label}" readonly>
        </div>
        <div class="modal-field">
          <label class="modal-label">Versión</label>
          ${versionField}
        </div>
        ${commonFieldsHTML(preview)}
        <!-- TODO: agregar bloque de autenticación (Basic user/password, Token, API key) -->
      `;
    }

    // TODO: implementar modal dinámico para ArcGIS REST
    // Campos específicos: auth_value (token opcional, input texto)
    // function arcgisFieldsHTML(preview, detectedParams) { ... }

    // TODO: implementar modal dinámico para CSV
    // Campos específicos: delimiter (select: coma/punto y coma/tab/pipe/auto), crs (input, default EPSG:4326)
    // function csvFieldsHTML(preview, detectedParams) { ... }

    // TODO: implementar modal dinámico para GeoJSON
    // Sin campos específicos adicionales por ahora.
    // function geojsonFieldsHTML(preview, detectedParams) { ... }

    // TODO: implementar modal dinámico para JSON (Google Sheets, arrays, etc.)
    // Sin campos específicos adicionales por ahora. A futuro: json_type, root_path.
    // function jsonFieldsHTML(preview, detectedParams) { ... }

    // Formatos con conector implementado pero sin modal dinámico todavía:
    // muestran los campos comunes genéricos hasta que se implementen los específicos.
    function genericFieldsHTML(preview) {
      return commonFieldsHTML(preview);
    }

    // Mensaje para formatos no soportados (xlsx, rss, etc.)
    function unsupportedHTML(format) {
      return `
        <div class="modal-field" style="padding:8px 0">
          <p style="color:var(--text-secondary);font-size:13px;margin:0">
            El formato <strong>${UTILS.escHtml(format)}</strong> aún no está soportado en Capibara.
          </p>
        </div>
      `;
    }

    // Renderiza los campos dinámicos y muestra/oculta el botón Conectar
    // implemented viene del registry vía detect.js — no se hardcodea acá
    function renderFields(format, preview, detectedParams, implemented) {
      const container = overlay.querySelector('#src-dynamic-fields');
      const saveBtn   = overlay.querySelector('#modal-save');

      if (!implemented) {
        container.innerHTML     = unsupportedHTML(format);
        saveBtn.style.display   = 'none';
        return;
      }

      if (format === 'wfs') {
        container.innerHTML = wfsFieldsHTML(preview, detectedParams);
      } else {
        // TODO: reemplazar por llamadas a los campos específicos de cada formato
        // cuando se implementen: arcgisFieldsHTML, csvFieldsHTML, geojsonFieldsHTML, jsonFieldsHTML
        container.innerHTML = genericFieldsHTML(preview);
      }

      saveBtn.style.display = '';
    }

    // ── Estado que persiste entre detect y save ────────────────────────────
    let _detectedFormat = null;

    // ── Handler: Detectar ──────────────────────────────────────────────────
    overlay.querySelector('#btn-detect').addEventListener('click', async () => {
      const url = overlay.querySelector('#src-url').value.trim();
      if (!url) { TOAST.warn('Ingresá una URL primero'); return; }

      const btn = overlay.querySelector('#btn-detect');
      btn.disabled = true;
      const { data, ok, error } = await API.detectFormat(url);
      btn.disabled = false;

      if (!ok) { TOAST.error('Error al detectar', error); return; }

      if (data.detected) {
        _detectedFormat = data.detected.format;
        // Hacer la URL readonly para evitar ediciones post-detección
        overlay.querySelector('#src-url').readOnly = true;
        renderFields(
          data.detected.format,
          data.preview || {},
          data.detected.detected_params || {},
          data.detected.implemented ?? false
        );
        TOAST.ok('Detectado', FMTS.get(data.detected.format)?.label || data.detected.format);
      } else {
        TOAST.warn('Formato no detectado', 'Revisá la URL e intentá de nuevo.');
      }
    });

    // ── Handler: Conectar (guardar + cascade) ──────────────────────────────
    overlay.querySelector('#modal-save').addEventListener('click', async () => {
      const url = overlay.querySelector('#src-url').value.trim();
      if (!url || !_detectedFormat) { TOAST.warn('Detectá el formato primero'); return; }

      // Armar connection_params según el formato
      const connParams = { url };
      if (_detectedFormat === 'wfs') {
        connParams.version = overlay.querySelector('#src-wfs-version')?.value || '1.1.0';
      }
      // TODO: para arcgis_rest: connParams.auth_value = overlay.querySelector('#src-auth-value')?.value || null
      // TODO: para csv: connParams.delimiter = ..., connParams.crs = ...

      const body = {
        connection_params: connParams,
        data_format:       _detectedFormat,
        name_alias:        overlay.querySelector('#src-alias')?.value.trim() || null,
        provider_alias:    overlay.querySelector('#src-provider')?.value.trim() || null,
        // name_source y provider_source se obtienen del connect step (GetCapabilities / service info)
        countries:         [...(overlay.querySelector('#src-countries')?.selectedOptions || [])].map(o => o.value),
        notes:             overlay.querySelector('#src-notes')?.value.trim() || null,
      };

      const saveBtn = overlay.querySelector('#modal-save');
      saveBtn.disabled = true;

      // 1. Crear fuente
      const { data: createData, ok: createOk, error: createErr } = await API.createSource(body);
      if (!createOk) {
        saveBtn.disabled = false;
        TOAST.error('Error al crear fuente', createErr);
        return;
      }

      const sourceId = createData.source.id;
      close();
      await load();
      TOAST.ok('Fuente creada', 'Conectando…');

      // 2. Auto-conectar
      const { data: connData, ok: connOk } = await API.connectSource(sourceId);
      if (!connOk || !connData?.ok) {
        TOAST.warn('Fuente creada', 'No se pudo conectar automáticamente. Usá el botón Conectar en el panel.');
        await load();
        return;
      }

      await load();
      TOAST.ok('Conectada', 'Descubriendo capas…');

      // 3. Auto-descubrir capas
      const { data: discData, ok: discOk } = await API.discoverLayers(sourceId);
      await load();
      if (discOk) {
        TOAST.ok('Listo', `${discData.added} capas descubiertas. Abrí la fuente para configurarlas.`);
      } else {
        TOAST.warn('Conectada', 'No se pudieron descubrir las capas automáticamente.');
      }
    });
  }

  // ── Acciones sobre una fuente ────────────────────────────────────────────

  async function connect(sourceId, btn) {
    if (btn) { btn.disabled = true; }
    const { data, ok, error } = await API.connectSource(sourceId);
    if (btn) { btn.disabled = false; }

    if (!ok) { TOAST.error('Error de conexión', error); return false; }
    if (data.ok) {
      TOAST.ok('Conectada', data.auto_populated?.length
        ? `Auto-completado: ${data.auto_populated.join(', ')}`
        : 'La fuente responde correctamente.');
    } else {
      TOAST.error('Conexión fallida', data.error);
    }
    await load();
    return data.ok;
  }

  async function discoverLayers(sourceId, btn) {
    if (btn) { btn.disabled = true; }
    const { data, ok, error } = await API.discoverLayers(sourceId);
    if (btn) { btn.disabled = false; }

    if (!ok) { TOAST.error('Error al descubrir capas', error); return false; }
    TOAST.ok(
      data.added > 0 ? 'Capas descubiertas' : 'Capas actualizadas',
      `${data.added} nuevas, ${data.skipped} ya existían.`
    );
    await load();
    return true;
  }

  async function deleteSource(sourceId) {
    if (!confirm('¿Eliminar esta fuente y todas sus capas y campos? Esta acción no se puede deshacer.')) return;
    const { ok, error } = await API.deleteSource(sourceId);
    if (!ok) { TOAST.error('Error al eliminar', error); return; }
    TOAST.ok('Fuente eliminada');
    await load();
  }

  return { load, onUpdate, openCreateModal, connect, discoverLayers, deleteSource };
})();
