/**
 * src/source-card.js — Componente de tarjeta de fuente
 *
 * window.CAPIBARA_SOURCE_CARD — factory que crea el HTML de una source card.
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

    el.className   = `source-card${!source.included ? ' is-disabled' : ''}`;
    el.dataset.id  = source.id;
    el.innerHTML   = `
      <div class="source-card-header">
        <span class="dot source-card-dot ${STATUS.get(source.status).dotClass}"
              title="${STATUS.get(source.status).label}"></span>
        <div class="source-card-meta">
          <div class="source-card-name" title="${UTILS.escHtml(name)}">${UTILS.escHtml(name)}</div>
          ${provider ? `<div class="source-card-provider">${UTILS.escHtml(provider)}</div>` : ''}
        </div>
      </div>
      <div class="source-card-pills">
        ${FMTS.pillHtml(source.data_format)}
        ${source.countries?.map(c => `<span class="pill pill-default">${c}</span>`).join('') || ''}
      </div>
      <div class="source-card-counts">
        <span class="source-card-count">
          <strong>${UTILS.formatNumber(source.layers_included)}</strong>/${UTILS.formatNumber(source.layers_total)} capas
        </span>
        <span class="source-card-count">
          <strong>${UTILS.formatNumber(source.fields_included)}</strong>/${UTILS.formatNumber(source.fields_total)} campos
        </span>
      </div>
      <div class="source-card-actions">
        <button class="btn btn-secondary btn-sm js-connect" data-id="${source.id}">Conectar</button>
        <button class="btn btn-secondary btn-sm js-discover" data-id="${source.id}">Descubrir capas</button>
        <button class="btn btn-ghost btn-sm js-delete" data-id="${source.id}" style="margin-left:auto;color:var(--error)">Eliminar</button>
      </div>
    `;

    return el;
  }

  return { render };
})();


/**
 * src/layer-row.js — Fila de capa en la tabla de layers
 */
window.CAPIBARA_LAYER_ROW = (() => {
  'use strict';

  const UTILS = window.CAPIBARA_UTILS;
  const DOM   = window.CAPIBARA_DOMAINS;
  const FREQ  = window.CAPIBARA_FREQUENCIES;
  const API   = window.CAPIBARA_API;
  const TOAST = window.CAPIBARA_TOAST;

  function render(layer) {
    const tr = document.createElement('tr');
    tr.dataset.id = layer.id;
    tr.innerHTML = `
      <td>
        <label class="toggle" title="${layer.included ? 'Incluida' : 'Excluida'}">
          <input type="checkbox" class="js-toggle-layer" data-id="${layer.id}" ${layer.included ? 'checked' : ''}>
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </td>
      <td>
        <div class="field-table-name">${UTILS.escHtml(layer.name_source)}</div>
        ${layer.name_alias ? `<div class="field-table-alias">${UTILS.escHtml(layer.name_alias)}</div>` : ''}
      </td>
      <td>
        <select class="select" style="width:100%;height:28px;font-size:12px" data-id="${layer.id}" data-field="domain">
          <option value="">— sin dominio —</option>
          ${DOM.options()}
        </select>
      </td>
      <td>
        <select class="select" style="width:100%;height:28px;font-size:12px" data-id="${layer.id}" data-field="update_frequency">
          ${FREQ.options()}
        </select>
      </td>
      <td class="mono" style="color:var(--text2)">${UTILS.formatNumber(layer.feature_count) || '—'}</td>
      <td>
        <button class="btn btn-secondary btn-sm js-discover-fields" data-id="${layer.id}">Descubrir campos</button>
      </td>
    `;

    // Setear valores actuales en selects
    tr.querySelector(`[data-field="domain"]`).value = layer.domain || '';
    tr.querySelector(`[data-field="update_frequency"]`).value = layer.update_frequency || 'unknown';

    // Toggle included
    tr.querySelector('.js-toggle-layer').addEventListener('change', async e => {
      const { ok, error } = await API.updateLayer(layer.id, { included: e.target.checked ? 1 : 0 });
      if (!ok) { TOAST.error('Error', error); e.target.checked = !e.target.checked; }
    });

    // Cambio de dominio o frecuencia
    tr.querySelectorAll('select[data-field]').forEach(sel => {
      sel.addEventListener('change', async e => {
        const field = e.target.dataset.field;
        await API.updateLayer(layer.id, { [field]: e.target.value || null });
      });
    });

    return tr;
  }

  return { render };
})();


/**
 * src/field-row.js — Fila de campo en la tabla de fields
 */
window.CAPIBARA_FIELD_ROW = (() => {
  'use strict';

  const UTILS = window.CAPIBARA_UTILS;
  const API   = window.CAPIBARA_API;
  const TOAST = window.CAPIBARA_TOAST;

  const TYPE_LABELS = {
    string: 'texto', integer: 'entero', float: 'decimal',
    boolean: 'booleano', geometry: 'geometría', unknown: '?',
  };

  function render(field) {
    const meta = typeof field.metadata === 'string'
      ? JSON.parse(field.metadata || '{}')
      : (field.metadata || {});

    const tr = document.createElement('tr');
    tr.dataset.id = field.id;
    tr.innerHTML = `
      <td>
        <label class="toggle">
          <input type="checkbox" class="js-toggle-field" data-id="${field.id}" ${field.included ? 'checked' : ''}>
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
        </label>
      </td>
      <td class="field-table-name">${UTILS.escHtml(field.name_source)}</td>
      <td>
        <input class="input field-alias-input" value="${UTILS.escHtml(field.name_alias || '')}"
               placeholder="Alias legible…" data-id="${field.id}" data-original="${UTILS.escHtml(field.name_alias || '')}">
      </td>
      <td style="color:var(--text2);font-size:12px">${TYPE_LABELS[field.type] || field.type}</td>
      <td class="mono" style="font-size:11px;color:var(--text3)">${UTILS.escHtml(meta.sample_value || '—')}</td>
      <td>
        <button class="btn btn-ghost btn-sm js-sample" data-id="${field.id}">Sample</button>
      </td>
    `;

    // Toggle included
    tr.querySelector('.js-toggle-field').addEventListener('change', async e => {
      const { ok, error } = await API.updateField(field.id, { included: e.target.checked ? 1 : 0 });
      if (!ok) { TOAST.error('Error', error); e.target.checked = !e.target.checked; }
    });

    // Alias: guardar al perder foco o presionar Enter
    const aliasInput = tr.querySelector('.field-alias-input');
    const saveAlias = UTILS.debounce(async (e) => {
      const val = e.target.value.trim();
      if (val === e.target.dataset.original) return;
      const { ok, error } = await API.updateField(field.id, { name_alias: val || null });
      if (ok) { e.target.dataset.original = val; }
      else TOAST.error('Error al guardar alias', error);
    }, 800);
    aliasInput.addEventListener('input', saveAlias);

    return tr;
  }

  return { render };
})();
