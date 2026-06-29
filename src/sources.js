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
      <div class="modal" style="max-width:480px">
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
              <input class="input input-mono" id="src-url" placeholder="https://..." style="flex:1">
              <button class="action-btn" id="btn-detect">Detectar</button>
            </div>
          </div>
          <div class="modal-field">
            <label class="modal-label">Formato</label>
            <div style="position:relative" id="fmt-wrap">
              <button type="button" class="select" id="fmt-trigger"
                style="display:flex;align-items:center;text-align:left;cursor:pointer">
                <span id="fmt-display" style="flex:1;color:var(--text2)">unknown</span>
              </button>
              <div id="fmt-dropdown" style="display:none;position:absolute;top:calc(100% + 2px);left:0;right:0;
                background:var(--bg);border:1.5px solid var(--border);border-radius:var(--radius);
                z-index:100;max-height:220px;overflow-y:auto"></div>
            </div>
          </div>
          <div class="modal-field">
            <label class="modal-label">Países</label>
            <div style="position:relative" id="ctry-wrap">
              <button type="button" class="select" id="ctry-trigger"
                style="display:flex;align-items:center;text-align:left;cursor:pointer">
                <span id="ctry-display" style="flex:1;color:var(--text2)">Seleccioná países…</span>
              </button>
              <div id="ctry-dropdown" style="display:none;position:absolute;top:calc(100% + 2px);left:0;right:0;
                background:var(--bg);border:1.5px solid var(--border);border-radius:var(--radius);
                z-index:100;max-height:220px;overflow-y:auto"></div>
            </div>
          </div>
          <div class="modal-field">
            <label class="modal-label">Nombre del servicio</label>
            <input class="input" id="src-name-source" placeholder="se completa al detectar" readonly>
          </div>
          <div class="modal-field">
            <label class="modal-label">Alias</label>
            <input class="input" id="src-alias" placeholder="nombre legible para el panel">
          </div>
          <div class="modal-field">
            <label class="modal-label">Proveedor del servicio</label>
            <input class="input" id="src-provider-source" placeholder="se completa al detectar" readonly>
          </div>
          <div class="modal-field">
            <label class="modal-label">Alias</label>
            <input class="input" id="src-provider" placeholder="nombre legible del proveedor">
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

    // ── Helper: custom select (igual para formato y países) ───────────────
    // multi=false → selección única, cierra al elegir
    // multi=true  → selección múltiple, permanece abierto
    function initCustomSelect({ prefix, options, multi, placeholder }) {
      const dd   = overlay.querySelector(`#${prefix}-dropdown`);
      const disp = overlay.querySelector(`#${prefix}-display`);
      const btn  = overlay.querySelector(`#${prefix}-trigger`);
      let   sel  = multi ? new Set() : null;

      const OPT_STYLE = 'display:flex;align-items:center;gap:8px;padding:6px 14px;cursor:pointer;font-size:13px;color:var(--text)';
      const CB_STYLE  = 'accent-color:var(--accent);cursor:pointer;flex-shrink:0';

      dd.innerHTML = options.map(o => `
        <label style="${OPT_STYLE}">
          <input type="checkbox" value="${o.value}" style="${CB_STYLE}">
          <span style="flex:1">${o.label}</span>
          ${o.sub ? `<span style="font-family:var(--font-mono);font-size:11px;color:var(--text2)">${o.sub}</span>` : ''}
        </label>`).join('');

      function refreshDisplay() {
        let text, hasVal;
        if (multi) {
          const codes = [...sel].sort();
          text   = codes.length ? codes.join(', ') : placeholder;
          hasVal = codes.length > 0;
        } else {
          const opt = options.find(o => o.value === sel);
          text   = opt ? opt.label : placeholder;
          hasVal = !!opt;
        }
        disp.textContent = text;
        disp.style.color = hasVal ? 'var(--text)' : 'var(--text2)';
      }

      dd.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
          if (multi) {
            if (cb.checked) sel.add(cb.value); else sel.delete(cb.value);
          } else {
            dd.querySelectorAll('input[type="checkbox"]').forEach(o => { if (o !== cb) o.checked = false; });
            sel = cb.checked ? cb.value : null;
            if (cb.checked) dd.style.display = 'none'; // cierra al elegir (single)
          }
          refreshDisplay();
        });
      });

      btn.addEventListener('click', e => {
        e.stopPropagation();
        dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
      });
      overlay.addEventListener('click', e => {
        if (!e.target.closest(`#${prefix}-wrap`)) dd.style.display = 'none';
      });

      return {
        getValue: () => multi ? [...sel].sort() : sel,
        setValue(val) {
          sel = multi ? new Set(Array.isArray(val) ? val : [val]) : (val || null);
          dd.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.checked = multi ? sel.has(cb.value) : cb.value === sel;
          });
          refreshDisplay();
        },
        lock()   { btn.disabled = true;  btn.style.opacity = '0.55'; },
        unlock() { btn.disabled = false; btn.style.opacity = ''; },
      };
    }

    // Inicializar formato (single select)
    const fmtSelect = initCustomSelect({
      prefix: 'fmt',
      options: [
        { value: '',            label: 'unknown' },
        { value: 'arcgis_rest', label: 'arcgis rest' },
        { value: 'csv',         label: 'csv' },
        { value: 'geojson',     label: 'geojson' },
        { value: 'json',        label: 'json' },
        { value: 'wfs',         label: 'wfs' },
      ],
      multi: false,
      placeholder: 'unknown',
    });

    // Inicializar países (multi select)
    const ctrySelect = initCustomSelect({
      prefix: 'ctry',
      options: window.CAPIBARA_COUNTRIES.LIST.map(c => ({ value: c.code, label: c.name, sub: c.code })),
      multi: true,
      placeholder: 'Seleccioná países…',
    });

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
        fmtSelect.setValue(data.detected.format);
        fmtSelect.lock();
        TOAST.ok('Detectado', FMTS.get(data.detected.format).label);
        if (data.preview?.name_source)     overlay.querySelector('#src-name-source').value     = data.preview.name_source;
        if (data.preview?.provider_source) overlay.querySelector('#src-provider-source').value = data.preview.provider_source;
      } else {
        fmtSelect.unlock();
        TOAST.warn('Formato no detectado', 'Seleccionalo manualmente.');
      }
    });

    // Guardar + cascade
    overlay.querySelector('#modal-save').addEventListener('click', async () => {
      const url    = overlay.querySelector('#src-url').value.trim();
      const format = fmtSelect.getValue();
      if (!url) { TOAST.warn('URL es requerida'); return; }

      const body = {
        connection_params: { url },
        data_format:       format,
        name_alias:        overlay.querySelector('#src-alias').value.trim() || null,
        provider_alias:    overlay.querySelector('#src-provider').value.trim() || null,
        // name_source y provider_source se obtienen del connect step (GetCapabilities)
        countries:         ctrySelect.getValue(),
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
