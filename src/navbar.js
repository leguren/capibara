/**
 * src/navbar.js — Navbar compartido
 *
 * Arma el HTML del navbar y lo inserta donde encuentre <div id="navbar-root">.
 * Este módulo NO sabe nada de sesión — el bloque del usuario (#nav-user)
 * lo rellena después src/auth.js (renderNavUser / renderNavUserMenu),
 * igual que antes cuando el navbar estaba hardcodeado en cada página.
 *
 * Tres variantes, una por tipo de página:
 *   renderPublic() → sin sesión (landing, explore, login)
 *   renderClient() → usuario logueado (home, keys, dashboard, playground, coverage, settings, docs)
 *   renderAdmin()  → admin logueado (admin, sources, analytics, users, keys)
 *
 * Uso, al principio del <body>:
 *   <div id="navbar-root"></div>
 *   <script src="/src/navbar.js"></script>
 *   <script>CAPIBARA_NAVBAR.renderClient('coverage');</script>
 */
window.CAPIBARA_NAVBAR = (() => {
  'use strict';

  const CLIENT_LINKS = [
    { key: 'playground', href: '/playground', label: 'Playground' },
    { key: 'coverage',   href: '/coverage',   label: 'Coverage'   },
    { key: 'keys',       href: '/keys',       label: 'Keys'       },
    { key: 'dashboard',  href: '/dashboard',  label: 'Dashboard'  },
    { key: 'docs',       href: '/docs',       label: 'Docs'       },
  ];

  const ADMIN_LINKS = [
    { key: 'sources',   href: '/admin/sources',   label: 'Fuentes'   },
    { key: 'analytics', href: '/admin/analytics', label: 'Analytics' },
    { key: 'users',     href: '/admin/users',     label: 'Usuarios'  },
    { key: 'keys',      href: '/admin/keys',      label: 'Keys'      },
  ];

  function linksHtml(links, active) {
    return links.map(l =>
      `<a href="${l.href}" class="navbar-link${l.key === active ? ' is-active' : ''}">${l.label}</a>`
    ).join('');
  }

  function mount(html) {
    const root = document.getElementById('navbar-root');
    if (!root) {
      console.error('[CAPIBARA_NAVBAR] falta <div id="navbar-root"></div> en esta página.');
      return;
    }
    root.outerHTML = html;
  }

  /**
   * renderClient(activeKey) → navbar del área de cliente
   * activeKey: 'playground' | 'coverage' | 'keys' | 'dashboard' | 'docs' | null
   * (home y settings no tienen link propio en el nav — se llega por el
   * logo y por el ícono de ajustes respectivamente — pasar null ahí)
   */
  function renderClient(activeKey) {
    mount(`
      <nav class="navbar">
        <a href="/home" class="navbar-brand">Capibara</a>
        <div class="navbar-nav">${linksHtml(CLIENT_LINKS, activeKey)}</div>
        <div class="navbar-spacer"></div>
        <a href="/settings" class="navbar-icon-btn" title="Ajustes" aria-label="Ajustes">⚙</a>
        <div class="navbar-user" id="nav-user"></div>
      </nav>
    `);
  }

  /**
   * renderAdmin(activeKey) → navbar del panel admin
   * activeKey: 'sources' | 'analytics' | 'users' | 'keys' | null (null en /admin)
   */
  function renderAdmin(activeKey) {
    mount(`
      <nav class="navbar">
        <a href="/admin" class="navbar-brand">Capibara</a>
        <div class="navbar-nav">${linksHtml(ADMIN_LINKS, activeKey)}</div>
        <div class="navbar-spacer"></div>
        <div class="navbar-user" id="nav-user"></div>
      </nav>
    `);
  }

  /**
   * renderPublic(opts?) → navbar sin sesión (landing, explore, login)
   * opts.showLogin: false oculta el botón "Ingresar" (ej: en la propia
   * página de login, donde mostrarlo sería redundante). Default: true.
   *
   * v1 a propósito — todavía no tiene links propios (Docs, Explorador).
   * Se completa más adelante.
   */
  function renderPublic(opts) {
    const showLogin = !opts || opts.showLogin !== false;
    mount(`
      <nav class="navbar">
        <a href="/" class="navbar-brand">Capibara</a>
        <div class="navbar-spacer"></div>
        ${showLogin ? `
        <div class="navbar-actions" id="nav-actions">
          <a href="/login" class="btn btn-ghost btn-sm">Ingresar</a>
        </div>` : ''}
      </nav>
    `);
  }

  return { renderClient, renderAdmin, renderPublic };
})();
