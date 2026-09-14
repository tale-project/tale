// Vite-exposed env vars consumed by the ui-docs client. Anything prefixed
// with `VITE_` is inlined into the bundle at build time; everything else is
// server-only and must not be referenced from client code.
interface ImportMetaEnv {
  /** Git branch the "Edit on GitHub" links point at. Defaults to `main`. */
  readonly VITE_UI_DOCS_BRANCH?: string;
  /**
   * Base URL of the GitHub repository (no trailing slash). The "Edit on
   * GitHub" links append `/edit/<branch>/services/ui-docs/content/<path>`.
   * Defaults to the public Tale repo.
   */
  readonly VITE_UI_DOCS_REPO_URL?: string;
  /** Public origin used for canonical/OG URLs. Defaults to ui.tale.dev. */
  readonly VITE_UI_DOCS_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
