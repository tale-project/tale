// Default docs URL for the marketing site. Production builds override via
// VITE_DOCS_URL at build time; falls back to the docs subdomain, which is
// where the proxy's docs host block serves the docs site.
const DEFAULT_DOCS_URL = 'https://docs.tale.dev';

export const DOCS_URL = import.meta.env.VITE_DOCS_URL ?? DEFAULT_DOCS_URL;

// Deep-link to the Start-tab quickstart (everyone's first 15 minutes), not the
// self-hosted install walk — that lives under /self-hosted/install/quickstart.
export const GET_STARTED_URL = `${DOCS_URL}/get-started/quickstart`;

/** Self-hosted install walk — the four-command sequence on the homepage CTA. */
export const SELF_HOSTED_QUICKSTART_URL = `${DOCS_URL}/self-hosted/install/quickstart`;
