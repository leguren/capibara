/**
 * src/source-card.js — Componente de tarjeta de fuente (solo informativa)
 *
 * Las cards son únicamente informativas. Los botones de acción
 * (conectar, descubrir, eliminar) viven en el panel lateral.
 * Click en la card → abre el panel.
 */

window.CAPIBARA_SOURCE_CARD = (() => {
  'use strict';

  const UTILS   = window.CAPIBARA_UTILS;
  const STATUS  = window.CAPIBARA_STATUS;
  const FMTS    = window.CAPIBARA_FORMATS;

  /**
   * render(source) → HTMLElement
   */
  function render(source) {
    const name     = UTILS.displayName(source);
    const provider = source.provider_alias || source.provider_source || '';
    const el       = document.createElement('div');

    el.className  = `source-card${!source.included ? ' is-disabled' : ''}`;
    el.dataset.id = source.id;
    el.innerHTML  = `
      <div class="source-card-header">
        <span class="dot ${STATUS.get(source.status).dotClass}"
              title="${STATUS.get(source.status).label}"></span>
        <div style="min-width:0;flex:1">
          <div class="source-card-name" title="${UTILS.escHtml(name)}">${UTILS.escHtml(name)}</div>
          ${provider ? `<div class="source-card-provider">${UTILS.escHtml(provider)}</div>` : ''}
        </div>
      </div>
      <div class="source-card-pills">
        ${FMTS.pillHtml(source.data_format)}
        ${(source.countries || []).map(c => `<span class="pill pill-default">${c}</span>`).join('')}
      </div>
      <div class="source-card-counts">
        <span><strong>${UTILS.formatNumber(source.layers_included)}</strong>/${UTILS.formatNumber(source.layers_total)} capas</span>
        <span><strong>${UTILS.formatNumber(source.fields_included)}</strong>/${UTILS.formatNumber(source.fields_total)} campos</span>
      </div>
    `;

    return el;
  }

  return { render };
})();


/**
 * src/layer-row.js — Fila de capa en el accordion del panel lateral
 *
 * Renderiza una fila expandible por capa dentro del panel de detalle de fuente.
 * No usa tabla — usa divs flexbox para evitar scroll horizontal.
 */
window.CAPIBARA_LAYER_ROW = (() => {
  'use strict';

  const UTILS = window.CAPIBARA_UTILS;
  const DOM   = window.CAPIBARA_DOMAINS;
  const FREQ  = window.CAPIBARA_FREQUENCIES;
  const API   = window.CAPIBARA_API;
  const TOAST = window.CAPIBARA_TOAST;

  function render(layer) {
    const item = document.createElement('div');
    item.className  = 'layer-item';
    item.dataset.id = layer.id;

    item.innerHTML = `
      <div class="layer-summary">
        <label class="toggle" title="${layer.included ? 'Incluida en API' : 'Excluida de API'}">
          <input type="checkbox" class="js-toggle-layer" data-id="${layer.id}" ${layer.included ? 'checked' : ''}>
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
        <span class="layer-name" title="${UTILS.escHtml(layer.name_source)}">${UTILS.escHtml(layer.name_source)}</span>
        ${layer.name_alias ? `<span class="layer-alias">→ ${UTILS.escHtml(layer.name_alias)}</span>` : ''}
        <span class="layer-geom">${(layer.geometry_type || 'UNKNOWN').toUpperCase()}</span>
        <button class="layer-expand-btn" aria-label="Expandir">▸</button>
      </div>
      <div class="layer-detail" hidden>
        <div class="layer-form-row">
          <span class="layer-form-label">Alias</span>
          <input class="input js-layer-alias" value="${UTILS.escHtml(layer.name_alias || '')}" placeholder="Nombre legible para la API">
        </div>
        <div class="layer-form-row">
          <span class="layer-form-label">Dominio</span>
          <select class="select js-layer-domain" style="width:180px">
            <option value="">— sin dominio —</option>
            ${DOM.options()}
          </select>
        </div>
        <div class="layer-form-row">
          <span class="layer-form-label">Frecuencia</span>
          <select class="select js-layer-freq" style="width:180px">
            ${FREQ.options()}
          </select>
        </div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
          <button class="btn btn-secondary btn-sm js-discover-fields">Descubrir campos</button>
          <span class="js-fields-count" style="font-size:11px;color:var(--text2)"></span>
        </div>
        <div class="fields-mini js-fields-mini" hidden></div>
      </div>
    `;

    // Setear valores actuales en selects
    item.querySelector('.js-layer-domain').value = layer.domain || '';
    item.querySelector('.js-layer-freq').value   = layer.update_frequency || 'unknown';

    // Toggle expand/collapse
    item.querySelector('.layer-summary').addEventListener('click', e => {
      if (e.target.closest('.toggle') || e.target.closest('.js-discover-fields')) return;
      const detail = item.querySelector('.layer-detail');
      const btn    = item.querySelector('.layer-expand-btn');
      const open   = detail.hidden;
      detail.hidden = !open;
      btn.textContent = open ? '▾' : '▸';
      item.classList.toggle('is-open', open);
    });

    // Toggle included
    item.querySelector('.js-toggle-layer').addEventListener('change', async e => {
      e.stopPropagation();
      const { ok, error } = await API.updateLayer(layer.id, { included: e.target.checked ? 1 : 0 });
      if (!ok) { TOAST.error('Error', error); e.target.checked = !e.target.checked; }
    });

    // Alias
    const aliasInput = item.querySelector('.js-layer-alias');
    let aliasTimer;
    aliasInput.addEventListener('input', e => {
      clearTimeout(aliasTimer);
      aliasTimer = setTimeout(async () => {
        await API.updateLayer(layer.id, { name_alias: e.target.value.trim() || null });
      }, 800);
    });

    // Domain
    item.querySelector('.js-layer-domain').addEventListener('change', async e => {
      await API.updateLayer(layer.id, { domain: e.target.value || null });
    });

    // Frequency
    item.querySelector('.js-layer-freq').addEventListener('change', async e => {
      await API.updateLayer(layer.id, { update_frequency: e.target.value || 'unknown' });
    });

    // Discover fields
    item.querySelector('.js-discover-fields').addEventListener('click', async e => {
      e.stopPropagation();
      const btn = e.currentTarget;
      btn.classList.add('btn-loading');
      const { data, ok, error } = await API.discoverFields(layer.id);
      btn.classList.remove('btn-loading');
      if (!ok) { TOAST.error('Error', error); return; }
      TOAST.ok('Campos descubiertos', `${data.added} nuevos, ${data.skipped} ya existían.`);
      // Cargar y mostrar los campos
      loadFields(item, layer.id);
    });

    return item;
  }

  async function loadFields(item, layerId) {
    const mini  = item.querySelector('.js-fields-mini');
    const count = item.querySelector('.js-fields-count');
    mini.hidden = false;
    mini.innerHTML = '<div class="skeleton" style="height:60px;border-radius:4px;margin-top:8px"></div>';

    const { data, ok } = await API.getLayerFields(layerId);
    if (!ok || !data?.fields?.length) {
      mini.innerHTML = '<div style="font-size:11px;color:var(--text3);padding:6px 0">Sin campos descubiertos.</div>';
      return;
    }

    count.textContent = `${data.fields.filter(f => f.included).length}/${data.fields.length} campos activos`;

    const rows = data.fields.map(f => {
      const meta = typeof f.metadata === 'string' ? JSON.parse(f.metadata || '{}') : (f.metadata || {});
      return `
        <div class="field-mini-row">
          <label class="toggle" style="flex-shrink:0">
            <input type="checkbox" class="js-toggle-field" data-id="${f.id}" ${f.included ? 'checked' : ''}>
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
          </label>
          <span class="field-mini-name" title="${UTILS.escHtml(f.name_source)}">${UTILS.escHtml(f.name_source)}</span>
          <span class="field-mini-type">${f.type || '?'}</span>
          <span class="field-mini-alias">
            <input class="input js-field-alias" data-id="${f.id}" value="${UTILS.escHtml(f.name_alias || '')}" placeholder="Alias">
          </span>
        </div>
      `;
    }).join('');

    mini.innerHTML = rows;

    // Toggle field included
    mini.querySelectorAll('.js-toggle-field').forEach(cb => {
      cb.addEventListener('change', async e => {
        const { ok, error } = await API.updateField(e.target.dataset.id, { included: e.target.checked ? 1 : 0 });
        if (!ok) { TOAST.error('Error', error); e.target.checked = !e.target.checked; }
      });
    });

    // Field alias
    mini.querySelectorAll('.js-field-alias').forEach(inp => {
      let t;
      inp.addEventListener('input', e => {
        clearTimeout(t);
        t = setTimeout(async () => {
          await API.updateField(e.target.dataset.id, { name_alias: e.target.value.trim() || null });
        }, 800);
      });
    });
  }

  return { render, loadFields };
})();