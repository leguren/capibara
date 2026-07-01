/**
 * api/admin/stats.js — Estadísticas generales del sistema
 *
 * GET /api/admin/stats
 * Devuelve conteos de fuentes, capas, campos y datos de la última publicación.
 * Usado por la landing /admin para el estado del sistema.
 */

const { getDb }        = require('../_turso');
const { initSchema }   = require('../_db');
const { requireAdmin } = require('../_auth');
const { checkOrigin }  = require('../_cors');
const { ok }           = require('../_utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkOrigin(req)) return res.status(403).json({ error: 'Forbidden' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  await initSchema();
  const session = requireAdmin(req, res);
  if (!session) return;

  const db = getDb();

  const [sourcesRes, layersRes, fieldsRes, pubRes] = await Promise.all([
    db.execute('SELECT COUNT(*) AS total, SUM(CASE WHEN status = \'ok\' THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN status = \'error\' THEN 1 ELSE 0 END) AS error FROM sources WHERE included = 1'),
    db.execute('SELECT COUNT(*) AS total, SUM(CASE WHEN included = 1 THEN 1 ELSE 0 END) AS included FROM layers'),
    db.execute('SELECT COUNT(*) AS total, SUM(CASE WHEN included = 1 THEN 1 ELSE 0 END) AS included FROM fields'),
    db.execute('SELECT version_label, created_at, published_by FROM publications ORDER BY created_at DESC LIMIT 1'),
  ]);

  return ok(res, {
    sources: {
      total: sourcesRes.rows[0]?.total || 0,
      ok:    sourcesRes.rows[0]?.ok    || 0,
      error: sourcesRes.rows[0]?.error || 0,
    },
    layers: {
      total:    layersRes.rows[0]?.total    || 0,
      included: layersRes.rows[0]?.included || 0,
    },
    fields: {
      total:    fieldsRes.rows[0]?.total    || 0,
      included: fieldsRes.rows[0]?.included || 0,
    },
    latest_publication: pubRes.rows.length ? {
      version:      pubRes.rows[0].version_label,
      created_at:   pubRes.rows[0].created_at,
      published_by: pubRes.rows[0].published_by,
    } : null,
  });
};
