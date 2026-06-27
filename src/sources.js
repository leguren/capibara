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
   * Crea la fuente y luego auto-conecta. Si la conexión es exitosa,
   * auto-descubre las capas. El usuario no necesita hacer nada manualmente.
   */
  function openCreateModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:520px">
        <div class="modal-header">
          <div class="modal-title">Nueva fuente</div>
          <button class="btn btn-ghost btn-icon" id="modal-close">×</button>
        </div>
        <div class="modal-body">
          <div class="form-group" style="margin-bottom:14px">
            <label class="form-label">URL del servicio</label>
            <div style="display:flex;gap:8px">
              <input class="input input-mono" id="src-url" style="flex:1">
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
              <label class="form-label">País (opcional)</label>
              <input class="input" id="src-country" style="text-transform:uppercase">
            </div>
            <div class="form-group">
              <label class="form-label">Nombre alias (opcional)</label>
              <input class="input" id="src-alias">
            </div>
            <div class="form-group">
              <label class="form-label">Proveedor alias (opcional)</label>
              <input class="input" id="src-provider">
            </div>
          </div>
          <div class="form-group" style="margin-top:12px">
            <label class="form-label">Notas internas (opcional)</label>
            <textarea class="textarea" id="src-notes" rows="2"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="modal-cancel">Cancelar</button>
          <button class="btn btn-primary" id="modal-save">Crear y conectar</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#modal-close').addEventListener('click', close);
    overlay.querySelector('#modal-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    // Detección automática de formato
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
        hint.textContent = 'No se pudo detectar el formato. Seleccionalo manualmente.';
      }
    });

    // Guardar + cascade
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
      saveBtn.disabled = true;

      // 1. Crear fuente
      const { data: createData, ok: createOk, error: createErr } = await API.createSource(body);
      if (!createOk) {
        saveBtn.classList.remove('btn-loading');
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
    if (btn) { btn.classList.add('btn-loading'); btn.disabled = true; }
    const { data, ok, error } = await API.connectSource(sourceId);
    if (btn) { btn.classList.remove('btn-loading'); btn.disabled = false; }

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
    if (btn) { btn.classList.add('btn-loading'); btn.disabled = true; }
    const { data, ok, error } = await API.discoverLayers(sourceId);
    if (btn) { btn.classList.remove('btn-loading'); btn.disabled = false; }

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