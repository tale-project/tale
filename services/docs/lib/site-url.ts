// Canonical fallback for the docs site URL. Production builds override via
// DOCS_SITE_URL (Node) or VITE_DOCS_SITE_URL (Vite); falls back to the docs
// subdomain, which is where the proxy's docs host block serves this site.
export const DEFAULT_DOCS_SITE_URL = 'https://docs.tale.dev';
