/**
 * vocab/formats.js — Formatos de datos de Capibara
 */
window.CAPIBARA_FORMATS = (() => {
  'use strict';

  const FORMATS = [
    { id: 'wfs',         label: 'wfs',         pillClass: 'pill-wfs'         },
    { id: 'arcgis_rest', label: 'arcgis rest',  pillClass: 'pill-arcgis-rest' },
    { id: 'csv',         label: 'csv',          pillClass: 'pill-csv'         },
    { id: 'geojson',     label: 'geojson',      pillClass: 'pill-geojson'     },
    { id: 'json',        label: 'json',         pillClass: 'pill-json'        },
    { id: 'xlsx',        label: 'excel',        pillClass: 'pill-default'     },
    { id: 'rss',         label: 'rss',          pillClass: 'pill-default'     },
  ];

  const MAP = Object.fromEntries(FORMATS.map(f => [f.id, f]));

  function get(id)   { return MAP[id] || { id, label: id, pillClass: 'pill-default' }; }
  function label(id) { return get(id).label; }
  function all()     { return FORMATS; }
  function pillHtml(id) {
    const f = get(id);
    return `<span class="pill ${f.pillClass}">${f.label}</span>`;
  }

  return { get, label, all, pillHtml };
})();
