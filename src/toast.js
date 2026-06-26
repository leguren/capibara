/**
 * src/toast.js — Sistema de notificaciones toast
 *
 * window.CAPIBARA_TOAST — IIFE que expone funciones para mostrar toasts.
 * Importar en todas las páginas antes que cualquier src/ que lo use.
 *
 * Uso:
 *   CAPIBARA_TOAST.ok('Publicado', 'La configuración está activa.')
 *   CAPIBARA_TOAST.error('Error', 'No se pudo conectar.')
 *   CAPIBARA_TOAST.warn('Atención', 'La fuente tiene errores parciales.')
 *   CAPIBARA_TOAST.info('Descubriendo capas...')
 */

window.CAPIBARA_TOAST = (() => {
  'use strict';

  let container = null;

  function getContainer() {
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  /**
   * show(type, title, desc?, duration?) → void
   *
   * type: 'ok' | 'error' | 'warning' | 'info'
   */
  function show(type, title, desc = '', duration = 4000) {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `
      <span class="toast-dot"></span>
      <div class="toast-body">
        <div class="toast-title">${title}</div>
        ${desc ? `<div class="toast-desc">${desc}</div>` : ''}
      </div>
      <button class="toast-close" aria-label="Cerrar">×</button>
    `;

    el.querySelector('.toast-close').addEventListener('click', () => dismiss(el));

    getContainer().appendChild(el);

    if (duration > 0) {
      setTimeout(() => dismiss(el), duration);
    }
  }

  function dismiss(el) {
    if (!el.isConnected) return;
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  return {
    ok:    (title, desc, ms) => show('ok', title, desc, ms),
    error: (title, desc, ms) => show('error', title, desc, ms),
    warn:  (title, desc, ms) => show('warning', title, desc, ms),
    info:  (title, desc, ms) => show('info', title, desc, ms),
  };
})();
