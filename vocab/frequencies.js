/**
 * vocab/frequencies.js — Frecuencias ISO 19115 MD_MaintenanceFrequencyCode
 */
window.CAPIBARA_FREQUENCIES = (() => {
  'use strict';
  const FREQUENCIES = [
    { id: 'unknown',      label: 'unknown',              ttl_h: 6 },
    { id: 'continual',    label: 'continua',             ttl_h: 0 },
    { id: 'daily',        label: 'diaria',               ttl_h: 1 },
    { id: 'weekly',       label: 'semanal',              ttl_h: 1 },
    { id: 'fortnightly',  label: 'quincenal',            ttl_h: 24 },
    { id: 'monthly',      label: 'mensual',              ttl_h: 24 },
    { id: 'quarterly',    label: 'trimestral',           ttl_h: 168 },
    { id: 'biannually',   label: 'semestral',            ttl_h: 168 },
    { id: 'annually',     label: 'anual',                ttl_h: 720 },
    { id: 'as_needed',    label: 'a demanda',            ttl_h: 6 },
    { id: 'irregular',    label: 'irregular',            ttl_h: 6 },
    { id: 'not_planned',  label: 'sin actualizaciones',  ttl_h: 2160 },
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
