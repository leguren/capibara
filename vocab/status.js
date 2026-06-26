/**
 * vocab/status.js — Traducción de códigos de status a texto y color
 *
 * window.CAPIBARA_STATUS — IIFE que expone el vocab de status.
 * Importar en todas las páginas que muestren el estado de fuentes.
 */

window.CAPIBARA_STATUS = (() => {
  'use strict';

  const STATUS = {
    ok: {
      label:     'Conectado',
      dotClass:  'dot-ok',
      pillClass: 'pill-ok',
    },
    degraded: {
      label:     'Degradado',
      dotClass:  'dot-degraded',
      pillClass: 'pill-degraded',
    },
    error: {
      label:     'Error',
      dotClass:  'dot-error',
      pillClass: 'pill-error',
    },
    unverified: {
      label:     'Sin verificar',
      dotClass:  'dot-unverified',
      pillClass: 'pill-unverified',
    },
    deprecated: {
      label:     'Deprecado',
      dotClass:  'dot-deprecated',
      pillClass: 'pill-deprecated',
    },
  };

  function get(status) {
    return STATUS[status] || STATUS.unverified;
  }

  function dotHtml(status) {
    const s = get(status);
    return `<span class="dot ${s.dotClass}" title="${s.label}"></span>`;
  }

  function pillHtml(status) {
    const s = get(status);
    return `<span class="pill ${s.pillClass}">${s.label}</span>`;
  }

  return { get, dotHtml, pillHtml };
})();
