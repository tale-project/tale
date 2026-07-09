/**
 * Build-time globals for the SEO helpers — canonical URLs for Tale's
 * published surfaces, plus their derived `llms.txt` / `llms-full.txt`
 * URLs. Every service's `scripts/build-llms-artifacts.ts` and on-demand
 * `.md` handler imports from here so cross-links stay consistent across
 * the marketing site, the docs site, and the platform.
 *
 * ## Configuration
 *
 * Each constant has a sensible default that matches the canonical
 * production deployment at https://tale.dev. To build against a
 * different host (fork, subdomain deployment, documentation mirror under
 * a custom domain, …), export the matching env var **before** running
 * the build script:
 *
 *   `TALE_SITE_URL`    — marketing site origin (default `https://tale.dev`)
 *   `TALE_DOCS_URL`    — docs site origin      (default `${TALE_SITE_URL}/docs`)
 *   `TALE_GITHUB_URL`  — source repo URL       (default `https://github.com/tale-project/tale`)
 *
 * These are **build-time** variables consumed by Node/Bun scripts. The
 * module is also importable from browser bundles (marketing pages build
 * canonical/JSON-LD URLs from it); there `process` is absent, so the
 * canonical production defaults apply.
 */

const env =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {};

/** Marketing site origin. */
export const TALE_SITE_URL = env.TALE_SITE_URL ?? 'https://tale.dev';

/** Documentation site origin. */
export const TALE_DOCS_URL = env.TALE_DOCS_URL ?? `${TALE_SITE_URL}/docs`;

/** Public source repository. */
export const TALE_GITHUB_URL =
  env.TALE_GITHUB_URL ?? 'https://github.com/tale-project/tale';

// --- Derived `llms.txt` / `llms-full.txt` URLs for cross-linking -----------

export const TALE_SITE_LLMS_TXT = `${TALE_SITE_URL}/llms.txt`;
export const TALE_SITE_LLMS_FULL_TXT = `${TALE_SITE_URL}/llms-full.txt`;
export const TALE_DOCS_LLMS_TXT = `${TALE_DOCS_URL}/llms.txt`;
export const TALE_DOCS_LLMS_FULL_TXT = `${TALE_DOCS_URL}/llms-full.txt`;
