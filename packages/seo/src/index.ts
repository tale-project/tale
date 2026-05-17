/**
 * Build-time SEO + LLM helpers for every Tale React service. Pure
 * Node/Bun, no React.
 *
 * Most consumers want the all-in-one runtime artifact server:
 *
 * ```ts
 * import { createArtifactsServer } from '@tale/seo';
 * ```
 *
 * `createArtifactsServer` lazily renders every `/llms.txt`,
 * `/llms-full.txt`, `/sitemap.xml`, `/robots.txt`, and `/<route>.md`
 * URL at request time and caches the result in-memory. Wire it into
 * `startReactServer` from `@tale/webui/server` for production and into
 * `artifactsPlugin` from `@tale/seo/vite-plugin-artifacts` for dev.
 *
 * Lower-level builders (`buildLlmsTxt`, `buildSitemap`, …) and the pure
 * `compileArtifacts` helper are also exported so callers that want to
 * write static files (e.g. CI-only snapshot exports) can call them
 * directly.
 */

export { buildLlmsTxt } from './llms-txt';
export type { LlmsTxtPage, LlmsTxtSection } from './llms-txt';

export { buildLlmsFullTxt } from './llms-full-txt';
export type { LlmsFullTxtPage } from './llms-full-txt';

export { buildSitemap, gitMtimeIso } from './sitemap';
export type { SitemapPage } from './sitemap';

export { buildRobotsTxt } from './robots';

export {
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
  buildArticleJsonLd,
  buildBreadcrumbListJsonLd,
} from './json-ld';
export type { BreadcrumbItem } from './json-ld';

export { pageAsMarkdown } from './page-as-markdown';
export { htmlToMarkdown } from './html-to-markdown';

export { compileArtifacts } from './artifacts';
export type {
  ArtifactRoute,
  ArtifactSection,
  OptionalPage,
  CompileArtifactsParams,
  CompiledArtifacts,
} from './artifacts';

export { createArtifactsServer } from './serve-artifacts';
export type {
  ArtifactsServer,
  ArtifactsServerParams,
  RobotsConfig,
} from './serve-artifacts';

// The Vite plugin is exposed only under the dedicated subpath
// (`@tale/seo/vite-plugin-artifacts`) — Vite is an optional peer
// dependency, so this barrel deliberately doesn't pull it in.

export * from './globals';
