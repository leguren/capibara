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
            <div style="display:flex;gap:8px">
              <input class="input" id="src-url" placeholder="https://..." style="flex:1">
              <button class="action-btn" id="btn-detect">Detectar</button>
            </div>
          </div>
          <div class="modal-field">
            <label class="modal-label">Formato</label>
            <div class="dd-wrap" id="fmt-wrap">
              <select class="select" id="src-format">
                <option value="">unknown</option>
                <option value="arcgis_rest">arcgis rest</option>
                <option value="csv">csv</option>
                <option value="geojson">geojson</option>
                <option value="json">json</option>
                <option value="wfs">wfs</option>
              </select>
              <span class="dd-icon">expand_more</span>
            </div>
          </div>
          <div class="modal-field">
            <label class="modal-label">Nombre del servicio</label>
            <input class="input" id="src-name-source" readonly>
          </div>
          <div class="modal-field">
            <label class="modal-label">Alias</label>
            <input class="input" id="src-alias" placeholder="Pasos internacionales">
          </div>
          <div class="modal-field">
            <label class="modal-label">Proveedor del servicio</label>
            <input class="input" id="src-provider-source" readonly>
          </div>
          <div class="modal-field">
            <label class="modal-label">Alias</label>
            <input class="input" id="src-provider" placeholder="Ministerio de Seguridad Nacional">
          </div>
          <div class="modal-field">
            <label class="modal-label">Países</label>
            <select class="select" id="src-countries" multiple style="height:60px">
              <option value="AG">Antigua y Barbuda AG</option>
              <option value="AR">Argentina AR</option>
              <option value="BB">Barbados BB</option>
              <option value="BZ">Belice BZ</option>
              <option value="BO">Bolivia BO</option>
              <option value="BR">Brasil BR</option>
              <option value="CA">Canadá CA</option>
              <option value="CL">Chile CL</option>
              <option value="CO">Colombia CO</option>
              <option value="CR">Costa Rica CR</option>
              <option value="CU">Cuba CU</option>
              <option value="DM">Dominica DM</option>
              <option value="EC">Ecuador EC</option>
              <option value="SV">El Salvador SV</option>
              <option value="US">Estados Unidos US</option>
              <option value="GD">Granada GD</option>
              <option value="GT">Guatemala GT</option>
              <option value="GY">Guyana GY</option>
              <option value="HT">Haití HT</option>
              <option value="HN">Honduras HN</option>
              <option value="JM">Jamaica JM</option>
              <option value="MX">México MX</option>
              <option value="NI">Nicaragua NI</option>
              <option value="PA">Panamá PA</option>
              <option value="PY">Paraguay PY</option>
              <option value="PE">Perú PE</option>
              <option value="PR">Puerto Rico PR</option>
              <option value="DO">República Dominicana DO</option>
              <option value="KN">Saint Kitts y Nevis KN</option>
              <option value="LC">Santa Lucía LC</option>
              <option value="VC">San Vicente y las Granadinas VC</option>
              <option value="SR">Surinam SR</option>
              <option value="TT">Trinidad y Tobago TT</option>
              <option value="UY">Uruguay UY</option>
              <option value="VE">Venezuela VE</option>
            </select>
          </div>
          <div class="modal-field">
            <label class="modal-label">Notas internas</label>
            <textarea class="input" id="src-notes" style="height:60px;resize:vertical;padding:8px 12px"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="action-btn" id="modal-cancel">Cancelar</button>
          <button class="action-btn primary" id="modal-save">Conectar</button>
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
      const url = overlay.querySelector('#src-url').value.trim();
      if (!url) { TOAST.warn('Ingresá una URL primero'); return; }
      const btn = overlay.querySelector('#btn-detect');
      btn.disabled = true;
      const { data, ok, error } = await API.detectFormat(url);
      btn.disabled = false;
      if (!ok) { TOAST.error('Error al detectar', error); return; }
      if (data.detected) {
        overlay.querySelector('#src-format').value    = data.detected.format;
        overlay.querySelector('#src-format').disabled = true;
        TOAST.ok('Detectado', FMTS.get(data.detected.format).label);
        if (data.preview?.name_source)     overlay.querySelector('#src-name-source').value     = data.preview.name_source;
        if (data.preview?.provider_source) overlay.querySelector('#src-provider-source').value = data.preview.provider_source;
      } else {
        overlay.querySelector('#src-format').disabled = false;
        TOAST.warn('Formato no detectado', 'Seleccionalo manualmente.');
      }
    });

    // Guardar + cascade
    overlay.querySelector('#modal-save').addEventListener('click', async () => {
      const url    = overlay.querySelector('#src-url').value.trim();
      const format = overlay.querySelector('#src-format').value;
      if (!url) { TOAST.warn('URL es requerida'); return; }

      const body = {
        connection_params: { url },
        data_format:       format,
        name_alias:        overlay.querySelector('#src-alias').value.trim() || null,
        provider_alias:    overlay.querySelector('#src-provider').value.trim() || null,
        // name_source y provider_source se obtienen del connect step (GetCapabilities)
        countries:         [...overlay.querySelector('#src-countries').selectedOptions].map(o => o.value),
        notes:             overlay.querySelector('#src-notes').value.trim() || null,
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
