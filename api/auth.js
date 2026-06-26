/**
 * api/auth.js — Autenticación OAuth consolidada
 *
 * Rutas (via vercel.json rewrites):
 *   GET  /api/auth/login    → ?sub=login
 *   GET  /api/auth/callback → ?sub=callback
 *   GET  /api/auth/logout   → ?sub=logout
 *   GET  /api/auth/me       → ?sub=me
 */

const { getDb }      = require('./_turso');
const { initSchema } = require('./_db');
const { createSession, requireAuth, setSessionCookie, clearSessionCookie } = require('./_auth');
const { id, now }    = require('./_utils');

const GOOGLE_AUTH_URL     = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL    = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const SCOPES = 'openid email profile';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const sub = req.query.sub;

  // ── LOGIN ─────────────────────────────────────────────────────────────────
  if (sub === 'login') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const clientId    = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    if (!clientId || !redirectUri) return res.status(500).json({ error: 'Google OAuth no configurado' });
    const params = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri,
      response_type: 'code', scope: SCOPES,
      access_type: 'online', prompt: 'select_account',
      state: Math.random().toString(36).slice(2),
    });
    return res.redirect(302, `${GOOGLE_AUTH_URL}?${params.toString()}`);
  }

  // ── CALLBACK ──────────────────────────────────────────────────────────────
  if (sub === 'callback') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const { code, error } = req.query;
    if (error) return res.redirect(302, '/login?error=oauth_denied');
    if (!code)  return res.redirect(302, '/login?error=missing_code');

    try {
      console.log('[callback] step 1: initSchema');
      await initSchema();
      console.log('[callback] step 2: exchange code for token');

      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id:     process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri:  process.env.GOOGLE_REDIRECT_URI,
          grant_type:    'authorization_code',
        }),
      });

      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        console.error('[callback] token exchange failed:', tokenRes.status, body);
        return res.redirect(302, '/login?error=token_exchange');
      }

      const tokens = await tokenRes.json();
      console.log('[callback] step 3: fetch user profile');

      const profileRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      if (!profileRes.ok) {
        console.error('[callback] profile fetch failed:', profileRes.status);
        return res.redirect(302, '/login?error=profile_fetch');
      }

      const profile = await profileRes.json();
      const email   = profile.email;
      if (!email) return res.redirect(302, '/login?error=no_email');

      console.log('[callback] step 4: upsert user, email:', email);
      const db = getDb();

      const existing = await db.execute({
        sql:  'SELECT id, email, name, picture, role, tier FROM users WHERE email = ? LIMIT 1',
        args: [email],
      });

      let user;
      if (existing.rows.length) {
        user = existing.rows[0];
        await db.execute({
          sql:  'UPDATE users SET last_login = ?, name = ?, picture = ? WHERE id = ?',
          args: [now(), profile.name || email, profile.picture || null, user.id],
        });
      } else {
        const newId = id('usr');
        await db.execute({
          sql:  `INSERT INTO users (id, email, name, picture, role, tier, created_at, last_login)
                 VALUES (?, ?, ?, ?, 'user', NULL, ?, ?)`,
          args: [newId, email, profile.name || email, profile.picture || null, now(), now()],
        });
        user = { id: newId, email, name: profile.name, picture: profile.picture, role: 'user', tier: null };
      }

      console.log('[callback] step 5: create session, role:', user.role);
      const token = createSession(user);
      setSessionCookie(res, token);
      return res.redirect(302, user.role === 'admin' ? '/admin' : '/dashboard');

    } catch (e) {
      console.error('[callback] ERROR:', e.message, e.stack);
      return res.redirect(302, '/login?error=server_error');
    }
  }

  // ── LOGOUT ────────────────────────────────────────────────────────────────
  if (sub === 'logout') {
    clearSessionCookie(res);
    return res.redirect(302, '/login');
  }

  // ── ME ────────────────────────────────────────────────────────────────────
  if (sub === 'me') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const session = requireAuth(req, res);
    if (!session) return;
    try {
      await initSchema();
      const db     = getDb();
      const result = await db.execute({
        sql:  'SELECT id, email, name, picture, role, tier, created_at, last_login FROM users WHERE id = ? LIMIT 1',
        args: [session.userId],
      });
      if (!result.rows.length) return res.status(401).json({ error: 'Usuario no encontrado' });
      return res.status(200).json(result.rows[0]);
    } catch (e) {
      console.error('[me] ERROR:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(404).json({ error: 'Ruta no encontrada' });
};
