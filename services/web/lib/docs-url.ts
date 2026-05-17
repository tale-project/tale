// Default docs URL for the marketing site. Production builds override via
// VITE_DOCS_URL at build time; falls back to the canonical tale.dev mount
// path.
const DEFAULT_DOCS_URL = 'https://tale.dev/docs';

export const DOCS_URL = import.meta.env.VITE_DOCS_URL ?? DEFAULT_DOCS_URL;
