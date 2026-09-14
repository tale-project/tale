// Canonical fallback for the design-system site URL. Production builds
// override via `UI_DOCS_SITE_URL` (Node/Bun) or `VITE_UI_DOCS_SITE_URL`
// (Vite); the fallback is the subdomain the proxy serves this site on.
export const DEFAULT_UI_DOCS_SITE_URL = 'https://ui.tale.dev';

/** Public repository the "Edit on GitHub" links and the hero CTA point at. */
export const TALE_REPO_URL = 'https://github.com/tale-project/tale';
