# Capibara

Plataforma B2B de datos geoespaciales sobre una coordenada.

Una sola API query → múltiples fuentes → respuesta unificada.

## Quick start

```bash
# Instalar
npm install

# Configurar
cp .env.example .env
# Editar .env con tus credenciales de Turso y Google OAuth

# Desarrollo local
vercel dev
```

## Stack

- **Backend**: Vercel serverless, Node.js CJS
- **DB**: Turso (libSQL / SQLite edge)
- **Auth**: Google OAuth + cookies HMAC-SHA256
- **Frontend**: Vanilla JS + HTML + CSS (sin build step)

## Estructura

```
api/          Serverless functions
admin/        Panel admin (HTML)
dashboard/    Panel usuario (HTML)
login/        Login OAuth (HTML)
publish/      Publicar config (HTML)
src/          Módulos JS frontend (IIFE)
style/        CSS modular
vocab/        Traducciones de códigos
config/       Config del frontend
docs/         Documentación
```

El schema de la base vive en `api/_db.js` (se crea solo en el primer cold start
contra una DB vacía — no hay carpeta de migraciones separada).

## Documentación

- [Arquitectura](docs/architecture.md)
- [Schema](docs/schema.md)
- [API pública](docs/api-geo.md)
- [API admin](docs/api-admin.md)
- [Autenticación](docs/api-auth.md)
- [Conectores](docs/connectors.md)
- [Dominios](docs/domains.md)
- [Deploy](docs/deploy.md)

## Endpoints principales

```
POST /api/admin/detect                    Detectar formato de URL
POST /api/admin/sources                   Crear fuente
POST /api/admin/sources/connect?id=       Verificar conexión
POST /api/admin/sources/discover?id=      Descubrir capas
POST /api/admin/publish                   Publicar configuración

GET  /api/geo/1/query?lat=&lon=           Query por coordenada (API key)
GET  /api/geo/1/catalog                   Catálogo de metadatos (público)
GET  /api/geo/1/catalog/coverage?lat=&lon= Cobertura en un punto (público)
```

## Ejemplo de uso

```bash
curl "https://capibara-ten.vercel.app/api/geo/1/query?lat=-34.603&lon=-58.382" \
  -H "Authorization: Bearer cpb_tutoken"
```
