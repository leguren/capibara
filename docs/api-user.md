# docs/api-user.md — Endpoints del dashboard /api/user/*

Todos requieren sesión autenticada (cookie). 401 si no hay sesión.

## API Keys

GET    /api/user/keys          → lista las keys del usuario (sin token, solo metadata)
POST   /api/user/keys          → crea una key nueva — devuelve el token UNA SOLA VEZ
PATCH  /api/user/keys?id=      → actualiza label o active
DELETE /api/user/keys?id=      → elimina la key

POST body: { label: string } — el tipo siempre es 'rest' (único soportado hoy, ver ROADMAP.md)

Response de POST:
{
  "id": "key_xxx",
  "label": "Mi app",
  "type": "rest",
  "active": 1,
  "created_at": "...",
  "token": "cpb_48bytesgithex...",
  "warning": "Guardá este token ahora. No se puede recuperar después."
}

Límite: 10 keys activas por usuario.
El token se muestra una sola vez. Si se pierde, eliminar y crear una nueva.

## Formato del token

Prefijo: cpb_
Longitud: cpb_ + 48 caracteres hex = 52 caracteres total
Uso: Authorization: Bearer cpb_...
