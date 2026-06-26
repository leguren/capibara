/**
 * src/sources.js — Módulo principal del panel admin de fuentes
 *
 * window.CAPIBARA_SOURCES — gestión de fuentes en el panel admin.
 * Coordina: listado, creación, conexión, descubrimiento y eliminación.
 */

window.CAPIBARA_SOURCES = (() => {
  'use strict';

  const API    = window.CAPIBARA_API;
  const TOAST  = window.CAPIBARA_TOAST;
  const UTILS  = window.CAPIBARA_UTILS;
  const STATUS = window.CAPIBARA_STATUS;
  const FMTS   = window.CAPIBARA_FORMATS;

  let _sources = [];
  let _onUpdate = null;

  // ── Listado ─────────────────────────────────────────────────────────────

  async function load() {
    const { data, ok, error } = await API.getSources();
    if (!ok) { TOAST.error('Error al cargar fuentes', error); return; }
    _sources = data.sources || [];
    if (_onUpdate) _onUpdate(_sources);
    return _sources;
  }

  function onUpdate(fn) { _onUpdate = fn; }

  // ── Creación ─────────────────────────────────────────────────────────────

  /**
   * openCreateModal() → void
   * Abre el modal de nueva fuente con detección automática de formato.
   */
  function openCreateModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:560px">
        <div class="modal-header">
          <div class="modal-title">Nueva fuente</div>
          <button class="btn btn-ghost btn-icon" id="modal-close">×</button>
        </div>
        <div class="modal-body">
          <div class="form-group" style="margin-bottom:12px">
            <label class="form-label">URL del servicio</label>
            <div style="display:flex;gap:8px">
              <input class="input input-mono" id="src-url" placeholder="https://..." style="flex:1">
              <button class="btn btn-secondary" id="btn-detect">Detectar</button>
            </div>
            <span class="form-hint" id="detect-hint">Pegá la URL y hacé clic en Detectar para auto-completar el formato.</span>
          </div>
          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">Formato</label>
              <select class="select" id="src-format">
                <option value="">— seleccionar —</option>
                <option value="wfs">WFS (OGC)</option>
                <option value="arcgis_rest">ArcGIS REST</option>
                <option value="csv">CSV</option>
                <option value="geojson">GeoJSON</option>
                <option value="json">JSON</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Nombre alias</label>
              <input class="input" id="src-alias" placeholder="IGN — Provincias">
            </div>
            <div class="form-group">
              <label class="form-label">Proveedor alias</label>
              <input class="input" id="src-provider" placeholder="IGN">
            </div>
            <div class="form-group">
              <label class="form-label">País</label>
              <input class="input" id="src-country" placeholder="AR" style="text-transform:uppercase">
            </div>
          </div>
          <div class="form-group" style="margin-top:12px">
            <label class="form-label">Notas internas</label>
            <textarea class="textarea" id="src-notes" rows="2" placeholder="Opcional: contexto sobre la fuente..."></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="modal-cancel">Cancelar</button>
          <button class="btn btn-primary" id="modal-save">Crear fuente</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#modal-close').addEventListener('click', close);
    overlay.querySelector('#modal-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    // Detección automática
    overlay.querySelector('#btn-detect').addEventListener('click', async () => {
      const url  = overlay.querySelector('#src-url').value.trim();
      const hint = overlay.querySelector('#detect-hint');
      if (!url) { TOAST.warn('Ingresá una URL primero'); return; }

      hint.textContent = 'Detectando…';
      const { data, ok, error } = await API.detectFormat(url);
      if (!ok) { hint.textContent = `Error: ${error}`; return; }

      if (data.detected) {
        overlay.querySelector('#src-format').value = data.detected.format;
        hint.textContent = `Detectado: ${FMTS.get(data.detected.format).label} (confianza: ${data.detected.confidence})`;
      } else {
        hint.textContent = 'No se pudo detectar el formato automáticamente. Seleccionalo manualmente.';
      }
    });

    // Guardar
    overlay.querySelector('#modal-save').addEventListener('click', async () => {
      const url    = overlay.querySelector('#src-url').value.trim();
      const format = overlay.querySelector('#src-format').value;
      if (!url || !format) { TOAST.warn('URL y formato son requeridos'); return; }

      const body = {
        connection_params: { url },
        data_format:       format,
        name_alias:        overlay.querySelector('#src-alias').value.trim() || null,
        provider_alias:    overlay.querySelector('#src-provider').value.trim() || null,
        countries:         overlay.querySelector('#src-country').value.trim()
                            ? [overlay.querySelector('#src-country').value.trim().toUpperCase()]
                            : [],
        notes:             overlay.querySelector('#src-notes').value.trim() || null,
      };

      const saveBtn = overlay.querySelector('#modal-save');
      saveBtn.classList.add('btn-loading');

      const { ok, error } = await API.createSource(body);
      saveBtn.classList.remove('btn-loading');

      if (!ok) { TOAST.error('Error al crear fuente', error); return; }

      TOAST.ok('Fuente creada', 'Ahora conectá y descubrí sus capas.');
      close();
      await load();
    });
  }

  // ── Acciones sobre una fuente ────────────────────────────────────────────

  async function connect(sourceId, btn) {
    if (btn) btn.classList.add('btn-loading');
    const { data, ok, error } = await API.connectSource(sourceId);
    if (btn) btn.classList.remove('btn-loading');

    if (!ok) { TOAST.error('Error de conexión', error); return false; }
    if (data.ok) {
      TOAST.ok('Conectado', data.auto_populated?.length
        ? `Auto-completado: ${data.auto_populated.join(', ')}`
        : 'La fuente responde correctamente.');
    } else {
      TOAST.error('Conexión fallida', data.error);
    }
    await load();
    return data.ok;
  }

  async function discoverLayers(sourceId, btn) {
    if (btn) btn.classList.add('btn-loading');
    const { data, ok, error } = await API.discoverLayers(sourceId);
    if (btn) btn.classList.remove('btn-loading');

    if (!ok) { TOAST.error('Error al descubrir capas', error); return; }
    TOAST.ok('Capas descubiertas', `${data.added} nuevas, ${data.skipped} ya existían.`);
    await load();
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
