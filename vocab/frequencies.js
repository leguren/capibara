/**
 * vocab/frequencies.js — Frecuencias ISO 19115 MD_MaintenanceFrequencyCode
 */
window.CAPIBARA_FREQUENCIES = (() => {
  'use strict';
  const FREQUENCIES = [
    { id: 'continual',    label: 'Continua',            ttl_h: 0 },
    { id: 'daily',        label: 'Diaria',              ttl_h: 1 },
    { id: 'weekly',       label: 'Semanal',             ttl_h: 1 },
    { id: 'fortnightly',  label: 'Quincenal',           ttl_h: 24 },
    { id: 'monthly',      label: 'Mensual',             ttl_h: 24 },
    { id: 'quarterly',    label: 'Trimestral',          ttl_h: 168 },
    { id: 'biannually',   label: 'Semestral',           ttl_h: 168 },
    { id: 'annually',     label: 'Anual',               ttl_h: 720 },
    { id: 'as_needed',    label: 'A demanda',           ttl_h: 6 },
    { id: 'irregular',    label: 'Irregular',           ttl_h: 6 },
    { id: 'not_planned',  label: 'Sin actualizaciones', ttl_h: 2160 },
    { id: 'unknown',      label: 'Desconocida',         ttl_h: 6 },
  ];
  const MAP = Object.fromEntries(FREQUENCIES.map(f => [f.id, f]));
  function get(id)   { return MAP[id] || MAP.unknown; }
  function label(id) { return get(id).label; }
  function all()     { return FREQUENCIES; }
  function options() {
    return FREQUENCIES.map(f => `<option value="${f.id}">${f.label}</option>`).join('');
  }
  return { get, label, all, options };
})();
