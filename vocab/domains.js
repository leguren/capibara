/**
 * vocab/domains.js — Los 20 dominios temáticos de Capibara
 * Separado de formats.js para carga condicional.
 */
window.CAPIBARA_DOMAINS = (() => {
  'use strict';
  const DOMAINS = [
    { id: 'geo',               label: 'Geografía',            emoji: '🗺️' },
    { id: 'normative',         label: 'Normativa',            emoji: '⚖️' },
    { id: 'cadastre',          label: 'Catastro',             emoji: '🏛️' },
    { id: 'social',            label: 'Social',               emoji: '👥' },
    { id: 'demographics',      label: 'Demografía',           emoji: '📊' },
    { id: 'electoral',         label: 'Electoral',            emoji: '🗳️' },
    { id: 'environment',       label: 'Medio ambiente',       emoji: '🌿' },
    { id: 'climate',           label: 'Clima',                emoji: '🌦️' },
    { id: 'biological_risk',   label: 'Riesgo biológico',     emoji: '🦠' },
    { id: 'defense',           label: 'Defensa',              emoji: '🛡️' },
    { id: 'security',          label: 'Seguridad',            emoji: '🚨' },
    { id: 'infrastructure',    label: 'Infraestructura',      emoji: '🏗️' },
    { id: 'transport',         label: 'Transporte',           emoji: '🚌' },
    { id: 'energy',            label: 'Energía',              emoji: '⚡' },
    { id: 'fire_risk',         label: 'Riesgo de incendio',   emoji: '🔥' },
    { id: 'geodynamic_risk',   label: 'Riesgo geodinámico',   emoji: '🌋' },
    { id: 'water_risk',        label: 'Riesgo hídrico',       emoji: '💧' },
    { id: 'weather_risk',      label: 'Riesgo meteorológico', emoji: '🌪️' },
    { id: 'technological_risk',label: 'Riesgo tecnológico',   emoji: '☣️' },
    { id: 'monitoring',        label: 'Monitoreo',            emoji: '📡' },
  ];
  const MAP = Object.fromEntries(DOMAINS.map(d => [d.id, d]));
  function get(id)   { return MAP[id] || { id, label: id, emoji: '📦' }; }
  function label(id) { return get(id).label; }
  function all()     { return DOMAINS; }
  function options() {
    return DOMAINS.map(d => `<option value="${d.id}">${d.emoji} ${d.label}</option>`).join('');
  }
  return { get, label, all, options };
})();
