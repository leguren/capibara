/**
 * src/progress.js — Barra de progreso global (top of page)
 *
 * window.CAPIBARA_PROGRESS — muestra una barra fina en el borde superior
 * durante cualquier operación asíncrona.
 *
 * API:
 *   PROGRESS.start()       → inicia (o acumula) una operación
 *   PROGRESS.done()        → finaliza con éxito
 *   PROGRESS.done(true)    → finaliza con error (rojo breve)
 *
 * Soporta operaciones concurrentes: la barra se mantiene mientras haya
 * al menos una operación activa.
 */
window.CAPIBARA_PROGRESS = (() => {
  'use strict';

  let el      = null;   // elemento DOM de la barra
  let active  = 0;      // contador de operaciones en curso
  let hideTimer = null;

  function ensure() {
    if (el) return;
    el = document.createElement('div');
    el.id = 'capibara-progress';
    el.innerHTML = '<div class="pb-fill"></div>';
    document.body.appendChild(el);
  }

  function start() {
    ensure();
    active++;
    clearTimeout(hideTimer);
    el.classList.remove('pb-done', 'pb-error', 'pb-hidden');
    el.classList.add('pb-running');
  }

  function done(isError = false) {
    active = Math.max(0, active - 1);
    if (active > 0) return; // otras operaciones siguen corriendo
    if (!el) return;
    el.classList.remove('pb-running');
    el.classList.add(isError ? 'pb-error' : 'pb-done');
    // Ocultar después de la transición
    hideTimer = setTimeout(() => {
      el.classList.remove('pb-done', 'pb-error');
      el.classList.add('pb-hidden');
    }, isError ? 700 : 400);
  }

  return { start, done };
})();
