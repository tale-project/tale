/**
 * Boot-shell plumbing shared by the production server (`server.ts`) and the
 * Vite dev/preview middlewares: the app is a SPA, so "SSR" for the dashboard
 * shell means the HTML server injects a prerendered skeleton into `#root`
 * for dashboard navigations. Everything here must stay pure and
 * dependency-free: it runs in Bun, Node (Vite), and tests.
 */

/**
 * Whether a navigation should be served with the boot shell: any path under
 * the dashboard (org pages, the org-less redirect frames). Everything else —
 * login, invites, share links — renders no dashboard chrome.
 */
export function shouldServeBootShell(pathname: string, basePath = ''): boolean {
  const path = stripBasePath(pathname, basePath);
  if (path === undefined) return false;
  return path === '/dashboard' || path.startsWith('/dashboard/');
}

/** The empty SPA mount point as it appears in `index.html`. */
const ROOT_MARKER = '<div id="root"></div>';

/**
 * Inject the prerendered shell into the empty `#root`. React's
 * `createRoot().render()` replaces it on the first commit; until then the
 * shell is the first paint. No-op when the marker is missing (unexpected
 * template drift) — a blank first paint is the graceful fallback, never a
 * broken document.
 */
export function injectBootShell(html: string, shellHtml: string): string {
  if (!html.includes(ROOT_MARKER)) return html;
  return html.replace(ROOT_MARKER, `<div id="root">${shellHtml}</div>`);
}

function stripBasePath(pathname: string, basePath: string): string | undefined {
  if (!basePath) return pathname;
  if (pathname === basePath) return '/';
  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length);
  }
  return undefined;
}
