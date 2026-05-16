// Canonical docs URL used by in-app links to public documentation. The
// platform doesn't currently expose this via runtime env injection (unlike
// SITE_URL), so a constant default lives here. Override at build time by
// editing this file if a deployment ships docs under a different origin.
export const DEFAULT_DOCS_URL = 'https://tale.dev/docs';
