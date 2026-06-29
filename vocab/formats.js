/**
 * vocab/formats.js — Traducción de formatos de datos a etiquetas y pills
 */
window.CAPIBARA_FORMATS = (() => {
  'use strict';

  const FORMATS = {
    wfs:         { label: 'wfs',          pillClass: 'pill-wfs' },
    arcgis_rest: { label: 'arcgis rest',  pillClass: 'pill-arcgis-rest' },
    csv:         { label: 'csv',          pillClass: 'pill-csv' },
    geojson:     { label: 'geojson',      pillClass: 'pill-geojson' },
    json:        { label: 'json',         pillClass: 'pill-json' },
    xlsx:        { label: 'excel',        pillClass: 'pill-default' },
    rss:         { label: 'rss',          pillClass: 'pill-default' },
  };

  function get(format) {
    return FORMATS[format] || { label: format, pillClass: 'pill-default' };
  }

  function pillHtml(format) {
    const f = get(format);
    return `<span class="pill ${f.pillClass}">${f.label}</span>`;
  }

  return { get, pillHtml };
})();


/**
 * vocab/domains.js — Los 20 dominios temáticos de Capibara
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

  function get(id)     { return MAP[id] || { id, label: id, emoji: '📦' }; }
  function label(id)   { return get(id).label; }
  function all()       { return DOMAINS; }
  function options()   {
    return DOMAINS.map(d => `<option value="${d.id}">${d.emoji} ${d.label}</option>`).join('');
  }

  return { get, label, all, options };
})();


/**
 * vocab/frequencies.js — Frecuencias de actualización ISO 19115
 */
window.CAPIBARA_FREQUENCIES = (() => {
  'use strict';

  const FREQUENCIES = [
    { id: 'continual',    label: 'Continua',       ttl_h: 0 },
    { id: 'daily',        label: 'Diaria',         ttl_h: 1 },
    { id: 'weekly',       label: 'Semanal',        ttl_h: 1 },
    { id: 'fortnightly',  label: 'Quincenal',      ttl_h: 24 },
    { id: 'monthly',      label: 'Mensual',        ttl_h: 24 },
    { id: 'quarterly',    label: 'Trimestral',     ttl_h: 168 },
    { id: 'biannually',   label: 'Semestral',      ttl_h: 168 },
    { id: 'annually',     label: 'Anual',          ttl_h: 720 },
    { id: 'as_needed',    label: 'A demanda',      ttl_h: 6 },
    { id: 'irregular',    label: 'Irregular',      ttl_h: 6 },
    { id: 'not_planned',  label: 'Sin actualizaciones', ttl_h: 2160 },
    { id: 'unknown',      label: 'Desconocida',    ttl_h: 6 },
  ];

  const MAP = Object.fromEntries(FREQUENCIES.map(f => [f.id, f]));

  function get(id)     { return MAP[id] || MAP.unknown; }
  function label(id)   { return get(id).label; }
  function all()       { return FREQUENCIES; }
  function options()   {
    return FREQUENCIES.map(f => `<option value="${f.id}">${f.label}</option>`).join('');
  }

  return { get, label, all, options };
})();
