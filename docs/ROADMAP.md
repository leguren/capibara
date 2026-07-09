# Capibara — Roadmap

Funcionalidades planificadas para versiones futuras. Ordenadas por área y prioridad aproximada.

---

## Infraestructura y confiabilidad

### Healthcheck automático de fuentes
Vercel soporta cron jobs desde el plan gratuito (`vercel.json` → `crons`).
Crear un endpoint `GET /api/admin/cron/healthcheck` que:
- Itera todas las fuentes con `included = 1`
- Llama `connector.connect(params)` con timeout corto (~5s)
- Actualiza `status` y `last_checked` en DB
- Registra errores en un log

Frecuencia sugerida: cada 6 horas.

### Notificaciones de fuentes caídas
Subsidiario del healthcheck. Cuando una fuente pasa de `status = 'ok'` a `status = 'error'`:
- Enviar email al admin via Resend (o similar) con el nombre de la fuente y el error
- Opcionalmente un webhook configurable por fuente
- Incluir un link directo a la fuente en el panel admin

Implementar como parte del mismo endpoint de cron, después del healthcheck.

---

## Panel admin

### Log de actividad
Registrar acciones de los admins en una tabla `admin_activity_log`:
- Quién conectó/descubrió/publicó/eliminó qué y cuándo
- Especialmente importante cuando hay múltiples admins
- UI: tabla simple en `/admin` con filtros por usuario y tipo de acción

Columnas sugeridas: `id, user_id, action, entity_type, entity_id, metadata_json, created_at`

---

## Interfaz del cliente (dashboard)

### Documentación auto-generada
A partir del catálogo publicado, generar una página de docs con:
- Todos los endpoints disponibles
- Parámetros aceptados con ejemplos
- Ejemplos de respuesta JSON por capa/dominio
- El admin la linkea a sus clientes sin escribir nada

Implementar como una página pública (`/docs`) generada desde `getLatestPublication()`.

### Dependencias entre capas
Idea: permitir que una capa enriquezca sus respuestas con datos de otra
(ej: un punto de interés que hereda datos del municipio que lo contiene,
consultando primero el polígono y usando un campo del resultado como
input de la segunda consulta).

Existió una implementación parcial (tabla `layer_dependencies` + resolución
en el query engine) pero nunca se le agregó forma de crear la relación
(ni UI ni endpoint), así que nunca se ejecutaba con datos reales — se sacó
del MVP para no mantener código muerto. Si en el futuro aparece un caso de
uso concreto, hay que reconstruir las tres partes desde cero:
- Tabla en el schema (`api/_db.js`)
- Resolución de orden de carga + inyección de params en `api/geo/query.js`
  (`executeGeoQuery`)
- UI en el panel admin: en el modal de editar capa, sección "Depende de"
  con selector de capas; indicar visualmente qué capas tienen dependencias

### Rate limit configurable por key/tier
Hoy el rate limiting (`api/_ratelimit.js`) usa un default global fijo en
código (`DEFAULT_KEY_RATE_LIMIT` en `api/geo/query.js`) para toda key sin
`rate_limit` propio. Falta UI en `/admin/keys` para setear un límite
específico por key o por tier, aprovechando la columna `rate_limit` que
ya existe en `api_keys`.

---

## Integraciones

### MCP para agentes IA
Existió un endpoint `/api/mcp` (wrapper JSON-RPC-like sobre `/api/geo/1/query`,
sin transporte MCP real — no SSE/stdio). Se sacó del MVP: agrega superficie
de mantenimiento sobre una hipótesis de integración (clientes B2B vía
agentes IA vs. API REST tradicional) que todavía no se validó. Retomar
si algún cliente piloto lo pide explícitamente, evaluando en ese momento
si conviene una integración MCP real o alcanza con documentar cómo usar
el REST existente desde un agente.

---

## Notas de implementación

- El healthcheck y las notificaciones se pueden implementar juntos en un solo PR
- Las dependencias entre capas requieren cambios en `api/geo/query.js` además de la UI
- La documentación auto-generada puede ser estática (generada en publish) o dinámica (generada en cada request con cache)
