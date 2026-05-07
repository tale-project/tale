// Vite-exposed env vars consumed by the docs client. Anything prefixed with
// `VITE_` is inlined into the bundle at build time; everything else is server-
// only and must not be referenced from client code.
interface ImportMetaEnv {
  /** Git branch the "Edit on GitHub" links point at. Defaults to `main`. */
  readonly VITE_DOCS_BRANCH?: string;
  /**
   * Base URL of the GitHub repository (no trailing slash). The "Edit on
   * GitHub" links append `/edit/<branch>/services/docs/app/content/<path>`.
   * Defaults to the public Tale repo.
   */
  readonly VITE_DOCS_REPO_URL?: string;
  /** Public docs origin used for canonical/OG URLs. */
  readonly VITE_DOCS_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '@fontsource-variable/inter';
declare module '@fontsource-variable/inter/index.css';
