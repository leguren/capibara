# docs/api-admin.md — Endpoints del panel admin /api/admin/*

Todos requieren sesión con role='admin'. 401/403 si no cumple.

## Detección de formato

POST /api/admin/detect
Body: { url: string }
Response: {
  url,
  detected: { format, confidence, from, detected_params, implemented },
  raw,
  fetch_error,
  preview: { name_source, provider_source }
}

confidence: 'high' | 'medium' | null
implemented: boolean — si Capibara tiene conector operativo para ese formato
detected_params (WFS): { version: '1.1.0' | null }

## Fuentes

GET    /api/admin/sources           → lista con conteos agregados
POST   /api/admin/sources           → crea fuente
GET    /api/admin/sources?id=       → detalle con capas
PATCH  /api/admin/sources?id=       → actualiza campos editables
DELETE /api/admin/sources?id=       → elimina (cascada en capas y campos)

POST   /api/admin/sources/connect?id=   → verifica conexión, auto-puebla nombre y proveedor
POST   /api/admin/sources/discover?id=  → descubre capas, detecta geometrías y bbox

Campos editables de sources via PATCH:
  name_alias, provider_alias, access_method, connection_params, included, notes

## Capas

GET    /api/admin/layers?source_id=     → lista capas de una fuente (columnas livianas)
GET    /api/admin/layers/fields?id=     → lista campos de la capa
GET    /api/admin/layers/sample?id=     → preview de datos (primeros 5 features via conector)
GET    /api/admin/layers/sample?id=&count=N → preview con N features (max 10)
POST   /api/admin/layers/discover?id=  → descubre campos (nuevos con included=1)
PATCH  /api/admin/layers?id=           → actualiza capa

Campos editables de layers via PATCH:
  included, name_alias, domain, update_frequency, notes

Response de GET layers/sample:
{
  "layer_id": "lyr_xxx",
  "layer_name": "ign:municipios",
  "features": [ { "type": "Feature", "properties": {...}, "geometry": {...} } ],
  "total": 1847
}

## Campos

PATCH /api/admin/fields?id=         → actualiza campo
GET   /api/admin/fields/sample?id=  → muestra hasta 10 valores únicos del campo

Campos editables de fields via PATCH:
  included, name_alias, notes

## Publicaciones

GET    /api/admin/publish        → lista últimas 10 publicaciones
GET    /api/admin/publish?id=    → detalle de una publicación (sources + layers)
POST   /api/admin/publish        → genera nueva publicación
DELETE /api/admin/publish?id=    → elimina una publicación

POST body: { notes?: string, version_label?: string }
Si version_label no se provee, se auto-incrementa el patch (v1.0.3 → v1.0.4).

Response de POST:
{
  "ok": true,
  "id": "pub_xxx",
  "version": "v1.0.3",
  "sources_count": 5,
  "layers_count": 23,
  "fields_count": 187
}

## Panel (consolidado en api/admin/panel.js)

GET /api/admin/stats → estado general del sistema
Response: {
  sources: { total, ok, error },
  layers: { total, included },
  fields: { total, included },
  latest_publication: { version, created_at, published_by } | null
}

GET /api/admin/usage?days=30 → analytics de uso (default: 30 días, max: 90)
Response: {
  period_days, total_requests, error_count, error_rate,
  avg_response_ms, max_response_ms,
  by_day: [{ day, requests, avg_ms }],
  top_keys: [{ key_id, label, requests, last_used }]
}

GET /api/admin/users → todos los usuarios
Response: {
  users: [{ id, email, name, role, created_at, last_login, keys_active, keys_total, last_api_use }]
}

GET    /api/admin/admin-keys     → todas las API keys del sistema
DELETE /api/admin/admin-keys?id= → revoca (desactiva) cualquier key

Response de GET:
{
  keys: [{ id, label, type, tier, active, created_at, last_used_at, user_id, user_email, user_name }]
}
