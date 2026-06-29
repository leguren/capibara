/**
 * api/admin/detect.js — Detección automática de formato
 *
 * POST /api/admin/detect
 */

const { requireAdmin } = require('../_auth');
const { checkOrigin }  = require('../_cors');
const { initSchema }   = require('../_db');

const TIMEOUT_MS = 15_000;


function extractWfsPreview(sample) {
  const titleM = sample.match(/<(?:[a-z]+:)?Title>([^<]{1,200})<\/(?:[a-z]+:)?Title>/i);
  const provM  = sample.match(/<(?:[a-z]+:)?ProviderName>([^<]{1,200})<\/(?:[a-z]+:)?ProviderName>/i)
               || sample.match(/<(?:[a-z]+:)?ContactOrganization>([^<]{1,200})<\/(?:[a-z]+:)?ContactOrganization>/i);
  return {
    name_source:     titleM?.[1]?.trim() || null,
    provider_source: provM?.[1]?.trim()  || null,
  };
}

function extractArcgisPreview(sample) {
  try {
    const d = JSON.parse(sample);
    return {
      name_source:     d.documentInfo?.Title || d.serviceDescription || d.name || null,
      provider_source: d.documentInfo?.Author || null,
    };
  } catch { return { name_source: null, provider_source: null }; }
}

function detectFromUrl(url) {
  const lower = url.toLowerCase();
  if (lower.includes('service=wfs') || lower.includes('request=getcapabilities')) return { format: 'wfs', confidence: 'high', from: 'url_params' };
  if (lower.includes('/featureserver') || lower.includes('/mapserver')) return { format: 'arcgis_rest', confidence: 'high', from: 'url_path' };
  if (lower.endsWith('.geojson') || lower.includes('.geojson?')) return { format: 'geojson', confidence: 'high', from: 'url_extension' };
  if (lower.endsWith('.csv') || lower.includes('.csv?')) return { format: 'csv', confidence: 'high', from: 'url_extension' };
  if (lower.endsWith('.json') || lower.includes('.json?')) return { format: 'json', confidence: 'medium', from: 'url_extension' };
  if (lower.includes('spreadsheets.googleapis.com')) return { format: 'json', confidence: 'high', from: 'url_path' };
  return null;
}

function detectFromContentType(ct) {
  if (!ct) return null;
  const c = ct.toLowerCase();
  if (c.includes('text/csv')) return { format: 'csv', confidence: 'high', from: 'content_type' };
  if (c.includes('application/geo+json')) return { format: 'geojson', confidence: 'high', from: 'content_type' };
  if (c.includes('application/xml') || c.includes('text/xml')) return { format: 'wfs', confidence: 'medium', from: 'content_type' };
  if (c.includes('application/json')) return { format: 'json', confidence: 'medium', from: 'content_type' };
  return null;
}

function detectFromBody(sample, ct) {
  if (sample.includes('WFS_Capabilities') || sample.includes('wfs:WFS_Capabilities')) { const v = sample.match(/version="([\d.]+)"/); return { format: 'wfs', confidence: 'high', from: 'response_body', detected_params: { version: v?.[1] || '1.1.0' } }; }
  if (sample.includes('"type"') && sample.includes('"FeatureCollection"')) return { format: 'geojson', confidence: 'high', from: 'response_body', detected_params: {} };
  if (sample.includes('"serviceDescription"') || sample.includes('"currentVersion"')) return { format: 'arcgis_rest', confidence: 'high', from: 'response_body', detected_params: {} };
  if (sample.includes('"majorDimension"') && sample.includes('"values"')) return { format: 'json', confidence: 'high', from: 'response_body', detected_params: { json_type: 'google_sheets' } };
  if (ct?.includes('json') && (sample.trimStart().startsWith('[') || sample.includes('"data"'))) return { format: 'json', confidence: 'medium', from: 'response_body', detected_params: {} };
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  await initSchema();
  const session = requireAdmin(req, res);
  if (!session) return;

  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'Se requiere url' });

  const fromUrl = detectFromUrl(url);
  // Incluso con detección por URL de alta confianza intentamos un preview
  // (nombre del servicio y proveedor del GetCapabilities/service JSON)
  if (fromUrl?.confidence === 'high') {
    let preview = { name_source: null, provider_source: null };
    try {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), 5_000);
      const r    = await fetch(url, { signal: ctrl.signal });
      const text = await r.text();
      if (fromUrl.format === 'wfs')         preview = extractWfsPreview(text);
      else if (fromUrl.format === 'arcgis_rest') preview = extractArcgisPreview(text);
    } catch { /* preview queda vacío */ }
    return res.status(200).json({ url, detected: { ...fromUrl, detected_params: {} }, raw: null, fetch_error: null, preview });
  }

  let fetchError = null, contentType = null, sample = '', statusCode = null;
  try {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const fetchRes   = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json, application/xml, text/csv, */*' } });
    clearTimeout(timer);
    statusCode  = fetchRes.status;
    contentType = fetchRes.headers.get('content-type') || '';
    sample      = (await fetchRes.text()).slice(0, 8192);
  } catch (e) { fetchError = e.message; }

  const raw = { content_type: contentType, status: statusCode, sample: sample.slice(0, 500) };
  if (fetchError) return res.status(200).json({ url, detected: fromUrl || null, raw: { ...raw, sample: null }, fetch_error: fetchError });

  const fromCT   = detectFromContentType(contentType);
  const fromBody = detectFromBody(sample, contentType);
  const best     = [fromBody, fromCT, fromUrl].filter(Boolean).find(c => c.confidence === 'high') ||
                   [fromBody, fromCT, fromUrl].filter(Boolean).find(c => c.confidence === 'medium') || null;

  if (best) {
    const preview = best.format === 'wfs'         ? extractWfsPreview(sample)
                  : best.format === 'arcgis_rest' ? extractArcgisPreview(sample)
                  : { name_source: null, provider_source: null };
    return res.status(200).json({ url, detected: { ...best, detected_params: best.detected_params || {}, note: null }, raw, fetch_error: null, preview });
  }

  try {
    const wfsUrl = new URL(url);
    wfsUrl.search = '';
    wfsUrl.searchParams.set('SERVICE', 'WFS');
    wfsUrl.searchParams.set('REQUEST', 'GetCapabilities');
    const probe = await fetch(wfsUrl.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body  = await probe.text();
    if (body.includes('WFS_Capabilities')) {
      const vMatch = body.match(/version="([\d.]+)"/);
      const previewP = extractWfsPreview(body);
      return res.status(200).json({ url, detected: { format: 'wfs', confidence: 'medium', from: 'capabilities_probe', detected_params: { version: vMatch?.[1] || '1.1.0' }, note: 'Detectado por probe' }, raw, fetch_error: null, preview: previewP });
    }
  } catch { /* no es WFS */ }

  return res.status(200).json({ url, detected: null, raw, fetch_error: null });
};
