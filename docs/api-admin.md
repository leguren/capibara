# docs/api-admin.md — Endpoints del panel admin /api/admin/*

Todos requieren sesión con role='admin'. 401/403 si no cumple.

## Detección de formato

POST /api/admin/detect
Body: { url: string }
Response: { url, detected: { format, confidence, from, detected_params }, raw, fetch_error }

confidence: 'high' | 'medium' | null

## Fuentes

GET    /api/admin/sources           → lista con conteos agregados
POST   /api/admin/sources           → crea fuente
GET    /api/admin/sources?id=       → detalle con capas
PATCH  /api/admin/sources?id=       → actualiza campos editables
DELETE /api/admin/sources?id=       → elimina (cascada en capas y campos)

POST   /api/admin/sources/connect?id=   → verifica conexión, auto-puebla nombre y proveedor
POST   /api/admin/sources/discover?id=  → descubre capas (nuevas con included=0)

Campos editables de sources via PATCH:
  name_alias, provider_alias, access_method, connection_params, included, notes

## Capas

PATCH /api/admin/layers?id=         → actualiza capa
GET   /api/admin/layers/fields?id=  → lista campos de la capa
POST  /api/admin/layers/discover?id= → descubre campos (nuevos con included=1)

Campos editables de layers via PATCH:
  included, name_alias, domain, update_frequency, notes

## Campos

PATCH /api/admin/fields?id=         → actualiza campo
GET   /api/admin/fields/sample?id=  → muestra hasta 10 valores únicos del campo

Campos editables de fields via PATCH:
  included, name_alias, notes

## Publicaciones

GET  /api/admin/publish → lista últimas 10 publicaciones
POST /api/admin/publish → genera nueva publicación

POST body: { notes?: string }

Response de POST:
{
  "ok": true,
  "id": "pub_xxx",
  "version": "v1.0.3",
  "sources_count": 5,
  "layers_count": 23,
  "fields_count": 187,
  "config": { ... }
}
