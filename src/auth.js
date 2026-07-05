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
    const t0 = performance.now();
    const { data, ok, error } = await window.CAPIBARA_API.getMe();
    const ms = Math.round(performance.now() - t0);

    // Diagnóstico: dejamos constancia en consola de exactamente qué pasó
    // en esta verificación de sesión, para poder distinguir:
    //  - fetch falló de verdad (timeout/red/500)   → error != null, ok=false
    //  - respondió 401 (sin cookie o cookie inválida) → error='No autenticado', ok=false
    //  - respondió 200 con el usuario                 → ok=true
    if (!ok) {
      console.warn(`[CAPIBARA_AUTH] /api/auth/me falló (${ms}ms): ${error || 'sin detalle'}`);
    } else {
      console.info(`[CAPIBARA_AUTH] /api/auth/me OK (${ms}ms) — user=${data?.email} role=${data?.role}`);
    }

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
      console.warn('[CAPIBARA_AUTH] requireAuth(): sin sesión válida → redirigiendo a /login');
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
      console.warn(`[CAPIBARA_AUTH] requireAdmin(): usuario ${user.email} tiene role="${user.role}" (no admin) → redirigiendo a /home`);
      window.location.href = '/home';
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

  /**
   * renderNavUserMenu(containerEl, user) → void
   *
   * Variante para el área de cliente: el avatar abre un menú desplegable
   * con Soporte y Cerrar sesión, en vez de mostrarlos siempre visibles
   * (eso queda para el navbar de admin, ver renderNavUser).
   */
  function renderNavUserMenu(containerEl, user) {
    if (!containerEl || !user) return;

    const initials = user.name
      ? user.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
      : user.email[0].toUpperCase();

    containerEl.innerHTML = `
      <div class="user-menu">
        <button class="user-menu-trigger" id="user-menu-trigger">
          <div class="navbar-avatar">
            ${user.picture
              ? `<img src="${user.picture}" alt="${user.name}" referrerpolicy="no-referrer">`
              : initials}
          </div>
        </button>
        <div class="user-menu-popover" id="user-menu-popover" style="display:none">
          <div class="user-menu-info">
            <div class="user-menu-name">${user.name || user.email}</div>
            ${user.name ? `<div class="user-menu-email">${user.email}</div>` : ''}
          </div>
          <a class="user-menu-item" href="mailto:soporte@capibara.dev">Soporte</a>
          <a class="user-menu-item" href="/api/auth/logout">Cerrar sesión</a>
        </div>
      </div>
    `;

    const trigger  = containerEl.querySelector('#user-menu-trigger');
    const popover  = containerEl.querySelector('#user-menu-popover');
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      popover.style.display = popover.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', () => { popover.style.display = 'none'; });
  }

  // ── Fix bfcache (Firefox y Safari) ──────────────────────────────────────
  // Cuando el browser restaura una página desde el back/forward cache, el
  // contexto JS queda con el estado anterior (_loaded, _user). Si ese estado
  // quedó corrupto, auth falla sin llamar a /api/auth/me.
  // La solución: al restaurar desde bfcache, resetear el estado y re-verificar.
  if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        console.info('[CAPIBARA_AUTH] pageshow desde bfcache detectado → reseteando estado de sesión');
        // Página restaurada desde bfcache — resetear y re-verificar sesión
        _user   = null;
        _loaded = false;
      }
    });
  }

  return { requireAuth, requireAdmin, getUser, renderNavUser, renderNavUserMenu };
})();
