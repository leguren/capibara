/**
 * api/mcp.js — POST /api/mcp
 *
 * Endpoint MCP (Model Context Protocol) para agentes IA.
 * Requiere API key con type='mcp'.
 * Acepta tool calls estilo MCP y los resuelve contra el endpoint query.
 */
const { requireApiKey } = require('./_auth');
const { initSchema, logUsage } = require('./_db');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  await initSchema();
  const keyInfo = await requireApiKey(req, res);
  if (!keyInfo) return;

  if (keyInfo.type !== 'mcp') {
    return res.status(403).json({ error: 'Esta key no es de tipo MCP. Crear una key con type=mcp.' });
  }

  const body = req.body || {};

  // Responde el manifest de herramientas disponibles
  if (body.method === 'tools/list' || !body.method) {
    return res.status(200).json({
      tools: [
        {
          name:        'query_location',
          description: 'Consulta datos geoespaciales para una coordenada geográfica. Devuelve información de múltiples fuentes: demografía, geografía, riesgos, normativa, infraestructura y más.',
          inputSchema: {
            type:       'object',
            properties: {
              lat:    { type: 'number', description: 'Latitud decimal WGS84 (ej: -34.603)' },
              lon:    { type: 'number', description: 'Longitud decimal WGS84 (ej: -58.382)' },
              domain: { type: 'string', description: 'Filtrar por dominio/s separados por coma (geo, environment, demographics, etc.)' },
            },
            required: ['lat', 'lon'],
          },
        },
        {
          name:        'get_catalog',
          description: 'Obtiene el catálogo de datos disponibles: qué dominios y capas están activos en la plataforma.',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name:        'check_coverage',
          description: 'Verifica qué datos están disponibles para una coordenada específica, sin hacer la consulta completa.',
          inputSchema: {
            type:       'object',
            properties: {
              lat: { type: 'number' },
              lon: { type: 'number' },
            },
            required: ['lat', 'lon'],
          },
        },
      ],
    });
  }

  // Ejecutar tool call
  if (body.method === 'tools/call') {
    const { name, arguments: args } = body.params || {};
    const baseUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000'}`;
    const authHeader = req.headers['authorization'];

    try {
      let apiUrl, apiRes, data;

      if (name === 'query_location') {
        apiUrl = `${baseUrl}/api/geo/1/query?lat=${args.lat}&lon=${args.lon}${args.domain ? '&domain=' + args.domain : ''}`;
      } else if (name === 'get_catalog') {
        apiUrl = `${baseUrl}/api/geo/1/catalog`;
      } else if (name === 'check_coverage') {
        apiUrl = `${baseUrl}/api/geo/1/catalog/coverage?lat=${args.lat}&lon=${args.lon}`;
      } else {
        return res.status(400).json({ error: `Herramienta desconocida: ${name}` });
      }

      apiRes = await fetch(apiUrl, { headers: { Authorization: authHeader } });
      data   = await apiRes.json();
      logUsage({ keyId: keyInfo.keyId, endpoint: '/api/mcp', lat: args?.lat, lon: args?.lon, statusCode: 200 });

      return res.status(200).json({
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      });

    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: `Método MCP desconocido: ${body.method}` });
};
