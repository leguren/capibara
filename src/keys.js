/**
 * src/keys.js — Gestión de API keys en el dashboard de usuario
 */

window.CAPIBARA_KEYS = (() => {
  'use strict';

  const API      = window.CAPIBARA_API;
  const TOAST    = window.CAPIBARA_TOAST;
  const UTILS    = window.CAPIBARA_UTILS;
  const PROGRESS = window.CAPIBARA_PROGRESS;

  let _keys    = [];
  let _onUpdate = null;

  async function load() {
    const { data, ok, error } = await API.getKeys();
    if (!ok) { TOAST.error('Error al cargar API keys', error); return; }
    _keys = data.keys || [];
    if (_onUpdate) _onUpdate(_keys);
    return _keys;
  }

  function onUpdate(fn) { _onUpdate = fn; }

  function openCreateModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:440px">
        <div class="modal-header">
          <div class="modal-title">Nueva API key</div>
          <button class="btn btn-ghost btn-icon" id="modal-close">×</button>
        </div>
        <div class="modal-body">
          <div class="form-group" style="margin-bottom:12px">
            <label class="form-label">Nombre</label>
            <input class="input" id="key-label" placeholder="Mi aplicación, Producción…">
            <span class="form-hint">Solo para identificar la key en tu lista.</span>
          </div>
          <div class="form-group">
            <label class="form-label">Tipo</label>
            <select class="select" id="key-type">
              <option value="rest">REST — clientes HTTP estándar</option>
              <option value="mcp">MCP — agentes IA</option>
            </select>
          </div>
          <div id="new-token-area" style="display:none;margin-top:16px">
            <div class="api-key-warning">⚠️ Copiá este token ahora. No se muestra de nuevo.</div>
            <div class="code-block" id="new-token-value" style="word-break:break-all"></div>
            <button class="btn btn-secondary btn-sm" id="btn-copy-token" style="margin-top:8px">Copiar token</button>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="modal-cancel">Cancelar</button>
          <button class="btn btn-primary" id="modal-save">Crear key</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('#modal-close').addEventListener('click', close);
    overlay.querySelector('#modal-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    overlay.querySelector('#modal-save').addEventListener('click', async () => {
      const label = overlay.querySelector('#key-label').value.trim();
      const type  = overlay.querySelector('#key-type').value;
      if (!label) { TOAST.warn('Ingresá un nombre para la key'); return; }

      const btn = overlay.querySelector('#modal-save');
      btn.classList.add('btn-loading');
      PROGRESS.start();
      const { data, ok, error } = await API.createKey({ label, type });
      btn.classList.remove('btn-loading');

      if (!ok) { PROGRESS.done(true); TOAST.error('Error al crear key', error); return; }
      PROGRESS.done();

      // Mostrar el token UNA SOLA VEZ
      const tokenArea  = overlay.querySelector('#new-token-area');
      const tokenValue = overlay.querySelector('#new-token-value');
      tokenArea.style.display = 'block';
      tokenValue.textContent  = data.token;
      btn.style.display = 'none';
      overlay.querySelector('#modal-cancel').textContent = 'Cerrar';
      overlay.querySelector('#modal-cancel').classList.replace('btn-secondary', 'btn-primary');

      overlay.querySelector('#btn-copy-token').addEventListener('click', async () => {
        await UTILS.copyToClipboard(data.token);
      });

      await load();
    });
  }

  async function revokeKey(keyId) {
    if (!confirm('¿Eliminar esta API key? Los clientes que la usen dejarán de funcionar.')) return;
    PROGRESS.start();
    const { ok, error } = await API.deleteKey(keyId);
    if (!ok) { PROGRESS.done(true); TOAST.error('Error al eliminar key', error); return; }
    PROGRESS.done();
    TOAST.ok('Key eliminada');
    await load();
  }

  function renderList(container, usageByKey = {}) {
    if (!container) return;
    if (!_keys.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-title">Sin API keys</div>
          <div class="empty-state-desc">Creá una key para empezar a consultar la API.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    for (const key of _keys) {
      const usageCount = usageByKey[key.id];
      const usageHtml  = usageCount != null
        ? `<span class="api-key-usage">${usageCount.toLocaleString('es')} req (30d)</span>`
        : '';
      const el = document.createElement('div');
      el.className = `api-key-row${!key.active ? ' is-disabled' : ''}`;
      el.innerHTML = `
        <div style="flex:1;min-width:0">
          <div class="api-key-label">${UTILS.escHtml(key.label)}</div>
          <div class="api-key-type">${key.type} · ${key.active ? 'activa' : 'inactiva'}</div>
        </div>
        ${usageHtml}
        <div class="api-key-used">
          ${key.last_used_at ? `Usada ${UTILS.timeAgo(key.last_used_at)}` : 'Nunca usada'}
        </div>
        <button class="btn btn-danger btn-sm js-revoke" data-id="${key.id}">Eliminar</button>
      `;
      el.querySelector('.js-revoke').addEventListener('click', () => revokeKey(key.id));
      container.appendChild(el);
    }
  }

  return { load, onUpdate, openCreateModal, revokeKey, renderList };
})();


/**
 * src/publish.js — Módulo de publicación
 */
window.CAPIBARA_PUBLISH = (() => {
  'use strict';

  const API      = window.CAPIBARA_API;
  const TOAST    = window.CAPIBARA_TOAST;
  const UTILS    = window.CAPIBARA_UTILS;
  const PROGRESS = window.CAPIBARA_PROGRESS;

  async function publish(notes = '') {
    const { data, ok, error } = await API.publish({ notes: notes || null });
    if (!ok) {
      TOAST.error('Error al publicar', error);
      return null;
    }
    TOAST.ok('Publicado', `${data.version} — ${data.layers_count} capas activas.`);
    return data;
  }

  async function loadHistory(containerEl) {
    const { data, ok } = await API.getPublications();
    if (!ok || !containerEl) return;

    const pubs = data.publications || [];
    if (!pubs.length) {
      containerEl.innerHTML = `<div class="empty-state"><div class="empty-state-desc">Sin publicaciones aún.</div></div>`;
      return;
    }

    containerEl.innerHTML = pubs.map(p => `
      <div class="publish-history-item">
        <span class="publish-version">${UTILS.escHtml(p.version_label)}</span>
        <div class="publish-meta">
          ${p.sources_count} fuentes · ${p.layers_count} capas · ${p.fields_count} campos
          <br>por ${UTILS.escHtml(p.published_by_name || p.published_by_email)}
        </div>
        <span class="publish-date">${UTILS.formatDate(p.created_at)}</span>
      </div>
    `).join('');
  }

  return { publish, loadHistory };
})();
