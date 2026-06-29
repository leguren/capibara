/**
 * vocab/countries.js — Países de América para el selector de fuentes
 *
 * Agrupados por región geográfica. Códigos ISO 3166-1 alpha-2.
 */
window.CAPIBARA_COUNTRIES = (() => {
  'use strict';

  const REGIONS = [
    {
      label: 'América del Norte',
      countries: [
        { code: 'CA', name: 'Canadá' },
        { code: 'MX', name: 'México' },
        { code: 'US', name: 'Estados Unidos' },
      ],
    },
    {
      label: 'América Central',
      countries: [
        { code: 'BZ', name: 'Belice' },
        { code: 'CR', name: 'Costa Rica' },
        { code: 'GT', name: 'Guatemala' },
        { code: 'HN', name: 'Honduras' },
        { code: 'NI', name: 'Nicaragua' },
        { code: 'PA', name: 'Panamá' },
        { code: 'SV', name: 'El Salvador' },
      ],
    },
    {
      label: 'Caribe',
      countries: [
        { code: 'AG', name: 'Antigua y Barbuda' },
        { code: 'BB', name: 'Barbados' },
        { code: 'BS', name: 'Bahamas' },
        { code: 'CU', name: 'Cuba' },
        { code: 'DM', name: 'Dominica' },
        { code: 'DO', name: 'República Dominicana' },
        { code: 'GD', name: 'Granada' },
        { code: 'HT', name: 'Haití' },
        { code: 'JM', name: 'Jamaica' },
        { code: 'KN', name: 'Saint Kitts y Nevis' },
        { code: 'LC', name: 'Santa Lucía' },
        { code: 'PR', name: 'Puerto Rico' },
        { code: 'TT', name: 'Trinidad y Tobago' },
        { code: 'VC', name: 'San Vicente y las Granadinas' },
      ],
    },
    {
      label: 'América del Sur',
      countries: [
        { code: 'AR', name: 'Argentina' },
        { code: 'BO', name: 'Bolivia' },
        { code: 'BR', name: 'Brasil' },
        { code: 'CL', name: 'Chile' },
        { code: 'CO', name: 'Colombia' },
        { code: 'EC', name: 'Ecuador' },
        { code: 'GY', name: 'Guyana' },
        { code: 'PE', name: 'Perú' },
        { code: 'PY', name: 'Paraguay' },
        { code: 'SR', name: 'Surinam' },
        { code: 'UY', name: 'Uruguay' },
        { code: 'VE', name: 'Venezuela' },
      ],
    },
  ];

  /** Mapa code → name para lookup rápido */
  const byCode = Object.fromEntries(
    REGIONS.flatMap(r => r.countries.map(c => [c.code, c.name]))
  );

  return { REGIONS, byCode };
})();
