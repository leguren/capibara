/**
 * vocab/countries.js — Países de América para el selector de fuentes
 *
 * Ordenados alfabéticamente por nombre. Códigos ISO 3166-1 alpha-2.
 */
window.CAPIBARA_COUNTRIES = (() => {
  'use strict';

  const LIST = [
    { code: 'AG', name: 'Antigua y Barbuda' },
    { code: 'AR', name: 'Argentina' },
    { code: 'BB', name: 'Barbados' },
    { code: 'BZ', name: 'Belice' },
    { code: 'BO', name: 'Bolivia' },
    { code: 'BR', name: 'Brasil' },
    { code: 'CA', name: 'Canadá' },
    { code: 'CL', name: 'Chile' },
    { code: 'CO', name: 'Colombia' },
    { code: 'CR', name: 'Costa Rica' },
    { code: 'CU', name: 'Cuba' },
    { code: 'DM', name: 'Dominica' },
    { code: 'EC', name: 'Ecuador' },
    { code: 'SV', name: 'El Salvador' },
    { code: 'US', name: 'Estados Unidos' },
    { code: 'GD', name: 'Granada' },
    { code: 'GT', name: 'Guatemala' },
    { code: 'GY', name: 'Guyana' },
    { code: 'HT', name: 'Haití' },
    { code: 'HN', name: 'Honduras' },
    { code: 'JM', name: 'Jamaica' },
    { code: 'MX', name: 'México' },
    { code: 'NI', name: 'Nicaragua' },
    { code: 'PA', name: 'Panamá' },
    { code: 'PY', name: 'Paraguay' },
    { code: 'PE', name: 'Perú' },
    { code: 'PR', name: 'Puerto Rico' },
    { code: 'DO', name: 'República Dominicana' },
    { code: 'KN', name: 'Saint Kitts y Nevis' },
    { code: 'LC', name: 'Santa Lucía' },
    { code: 'VC', name: 'San Vicente y las Granadinas' },
    { code: 'SR', name: 'Surinam' },
    { code: 'TT', name: 'Trinidad y Tobago' },
    { code: 'UY', name: 'Uruguay' },
    { code: 'VE', name: 'Venezuela' },
  ];

  const byCode = Object.fromEntries(LIST.map(c => [c.code, c.name]));

  return { LIST, byCode };
})();
