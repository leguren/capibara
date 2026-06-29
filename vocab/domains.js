/**
 * vocab/domains.js — Los 20 dominios temáticos de Capibara
 * Separado de formats.js para carga condicional.
 */
window.CAPIBARA_DOMAINS = (() => {
  'use strict';
  const DOMAINS = [
    { id: 'geo',               label: 'geografía'            },
    { id: 'normative',         label: 'normativa'            },
    { id: 'cadastre',          label: 'catastro'             },
    { id: 'social',            label: 'social'               },
    { id: 'demographics',      label: 'demografía'           },
    { id: 'electoral',         label: 'electoral'            },
    { id: 'environment',       label: 'medio ambiente'       },
    { id: 'climate',           label: 'clima'                },
    { id: 'biological_risk',   label: 'riesgo biológico'     },
    { id: 'defense',           label: 'defensa'              },
    { id: 'security',          label: 'seguridad'            },
    { id: 'infrastructure',    label: 'infraestructura'      },
    { id: 'transport',         label: 'transporte'           },
    { id: 'energy',            label: 'energía'              },
    { id: 'fire_risk',         label: 'riesgo de incendio'   },
    { id: 'geodynamic_risk',   label: 'riesgo geodinámico'   },
    { id: 'water_risk',        label: 'riesgo hídrico'       },
    { id: 'weather_risk',      label: 'riesgo meteorológico' },
    { id: 'technological_risk',label: 'riesgo tecnológico'   },
    { id: 'monitoring',        label: 'monitoreo'            },
  ];
  const MAP = Object.fromEntries(DOMAINS.map(d => [d.id, d]));
  function get(id)   { return MAP[id] || { id, label: id }; }
  function label(id) { return get(id).label; }
  function all()     { return DOMAINS; }
  function options() {
    const unknown = `<option value="">unknown</option>`;
    return unknown + DOMAINS.map(d => `<option value="${d.id}">${d.label}</option>`).join('');
  }
  return { get, label, all, options };
})();
