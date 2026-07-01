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
La tabla `layer_dependencies` existe en el schema pero no tiene UI.
Permite que una capa enriquezca sus respuestas con datos de otra
(ej: un punto de interés que hereda datos del municipio que lo contiene).

UI necesaria:
- En el modal de editar capa, sección "Depende de" con selector de capas
- En el panel, indicar visualmente qué capas tienen dependencias
- En el query engine, resolver dependencias antes de responder

---

## Notas de implementación

- El healthcheck y las notificaciones se pueden implementar juntos en un solo PR
- Las dependencias entre capas requieren cambios en `api/geo/query.js` además de la UI
- La documentación auto-generada puede ser estática (generada en publish) o dinámica (generada en cada request con cache)
