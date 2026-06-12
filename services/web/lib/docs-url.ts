// Default docs URL for the marketing site. Production builds override via
// VITE_DOCS_URL at build time; falls back to the canonical tale.dev mount
// path.
const DEFAULT_DOCS_URL = 'https://tale.dev/docs';

export const DOCS_URL = import.meta.env.VITE_DOCS_URL ?? DEFAULT_DOCS_URL;

// Deep-link to the getting-started page. The hero's "Get started" CTA points
// here so a reader lands on the three-command quickstart, not the docs index.
export const GET_STARTED_URL = `${DOCS_URL}/self-hosted/install/quickstart`;
