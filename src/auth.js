/**
 * src/auth.js — Verificación de sesión del lado del cliente
 *
 * window.CAPIBARA_AUTH — IIFE que expone el estado de autenticación
 * y helpers para proteger páginas que requieren login.
 *
 * Uso:
 *   await CAPIBARA_AUTH.requireAuth()    → redirige a /login si no hay sesión
 *   await CAPIBARA_AUTH.requireAdmin()   → redirige si no es admin
 *   CAPIBARA_AUTH.getUser()             → devuelve el usuario actual o null
 *
 * La sesión se verifica una sola vez por carga de página.
 */

window.CAPIBARA_AUTH = (() => {
  'use strict';

  let _user   = null;
  let _loaded = false;

  async function loadUser() {
    if (_loaded) return _user;
    const { data, ok } = await window.CAPIBARA_API.getMe();
    _user   = ok ? data : null;
    _loaded = true;
    return _user;
  }

  /**
   * requireAuth() → user | redirect
   *
   * Carga el usuario. Si no hay sesión válida, redirige al login.
   */
  async function requireAuth() {
    const user = await loadUser();
    if (!user) {
      window.location.href = '/login';
      return null;
    }
    return user;
  }

  /**
   * requireAdmin() → user | redirect
   *
   * Como requireAuth, pero además verifica role === 'admin'.
   */
  async function requireAdmin() {
    const user = await requireAuth();
    if (!user) return null;
    if (user.role !== 'admin') {
      window.location.href = '/dashboard';
      return null;
    }
    return user;
  }

  /**
   * getUser() → user | null
   *
   * Devuelve el usuario cargado, o null si no hay sesión.
   * Solo disponible después de haber llamado requireAuth/requireAdmin.
   */
  function getUser() {
    return _user;
  }

  /**
   * renderNavUser(containerEl, user) → void
   *
   * Renderiza el avatar y nombre del usuario en el navbar.
   */
  function renderNavUser(containerEl, user) {
    if (!containerEl || !user) return;

    const initials = user.name
      ? user.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
      : user.email[0].toUpperCase();

    containerEl.innerHTML = `
      <div class="navbar-avatar">
        ${user.picture
          ? `<img src="${user.picture}" alt="${user.name}" referrerpolicy="no-referrer">`
          : initials}
      </div>
      <span>${user.name || user.email}</span>
      <a href="/api/auth/logout" class="btn btn-ghost btn-sm">Salir</a>
    `;
  }

  // ── Fix bfcache (Firefox y Safari) ──────────────────────────────────────
  // Cuando el browser restaura una página desde el back/forward cache, el
  // contexto JS queda con el estado anterior (_loaded, _user). Si ese estado
  // quedó corrupto, auth falla sin llamar a /api/auth/me.
  // La solución: al restaurar desde bfcache, resetear el estado y re-verificar.
  if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        // Página restaurada desde bfcache — resetear y re-verificar sesión
        _user   = null;
        _loaded = false;
      }
    });
  }

  return { requireAuth, requireAdmin, getUser, renderNavUser };
})();
