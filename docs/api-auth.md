# docs/api-auth.md — Endpoints de autenticación /api/auth/*

## Flujo OAuth

GET /api/auth/login    → redirige a Google OAuth
GET /api/auth/callback → procesa el code, crea sesión, redirige a /admin o /dashboard
GET /api/auth/logout   → elimina cookie, redirige a /login
GET /api/auth/me       → devuelve usuario de la sesión activa (401 si no hay sesión)

## Cookie de sesión

Nombre: capibara_session
Formato: base64url(payload).base64url(hmac-sha256)
Atributos: HttpOnly, Secure, SameSite=Lax, Max-Age=7días
El payload contiene: { userId, email, role, exp }

## Variables de entorno requeridas

GOOGLE_CLIENT_ID       → de Google Cloud Console
GOOGLE_CLIENT_SECRET   → de Google Cloud Console
GOOGLE_REDIRECT_URI    → debe coincidir exactamente con el Authorized Redirect URI registrado
SESSION_SECRET         → string aleatorio largo para firmar las cookies

## Primer admin

Después del primer login, cambiar role manualmente en Turso:
  UPDATE users SET role = 'admin' WHERE email = 'tu@email.com';

Los logins subsiguientes detectan el role desde la DB y lo incluyen en la cookie.
