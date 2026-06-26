/**
 * src/utils.js — Utilidades del frontend compartidas
 *
 * window.CAPIBARA_UTILS — funciones auxiliares de presentación.
 */

window.CAPIBARA_UTILS = (() => {
  'use strict';

  /**
   * timeAgo(isoString) → string legible
   * 'hace 3 días', 'hace 2 horas', 'ahora'
   */
  function timeAgo(isoString) {
    if (!isoString) return '—';
    const diff = Date.now() - new Date(isoString).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 2)   return 'ahora';
    if (mins < 60)  return `hace ${mins} min`;
    const hrs = Math.floor(mins / 60);
    if (hrs  < 24)  return `hace ${hrs}h`;
    const days = Math.floor(hrs / 24);
    if (days < 30)  return `hace ${days}d`;
    const months = Math.floor(days / 30);
    return `hace ${months} mes${months > 1 ? 'es' : ''}`;
  }

  /**
   * formatDate(isoString) → 'DD/MM/YYYY HH:MM'
   */
  function formatDate(isoString) {
    if (!isoString) return '—';
    const d = new Date(isoString);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /**
   * copyToClipboard(text, btn?) → void
   * Copia texto al portapapeles. Si se pasa el botón, lo anima brevemente.
   */
  async function copyToClipboard(text, btn = null) {
    try {
      await navigator.clipboard.writeText(text);
      if (btn) {
        const prev = btn.textContent;
        btn.textContent = '✓ Copiado';
        setTimeout(() => { btn.textContent = prev; }, 1800);
      }
      window.CAPIBARA_TOAST?.ok('Copiado al portapapeles');
    } catch {
      window.CAPIBARA_TOAST?.error('No se pudo copiar');
    }
  }

  /**
   * escHtml(str) → string con caracteres HTML escapados
   */
  function escHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * debounce(fn, ms) → function
   */
  function debounce(fn, ms = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  /**
   * formatNumber(n) → '1.234' con separadores de miles
   */
  function formatNumber(n) {
    if (n === null || n === undefined) return '—';
    return Number(n).toLocaleString('es-AR');
  }

  /**
   * displayName(item) → name_alias || name_source
   * Aplica la convención de aliases de Capibara a cualquier objeto con esos campos.
   */
  function displayName(item) {
    return item?.name_alias || item?.name_source || item?.id || '—';
  }

  return { timeAgo, formatDate, copyToClipboard, escHtml, debounce, formatNumber, displayName };
})();
