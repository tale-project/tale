// Default docs URL for the marketing site. Production builds override via
// VITE_DOCS_URL at build time; falls back to the canonical tale.dev mount
// path. Node-side build scripts read the same value via WEB_DOCS_URL.
export const DEFAULT_DOCS_URL = 'https://tale.dev/docs';

export const DOCS_URL = import.meta.env.VITE_DOCS_URL ?? DEFAULT_DOCS_URL;
