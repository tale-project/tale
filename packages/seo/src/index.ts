/**
 * Build-time SEO + LLM helpers for every Tale React service. Pure
 * Node/Bun, no React.
 *
 * Two runtime modes:
 *
 * - **Dev** — {@link createOnDemandServer} (alias `createArtifactsServer`).
 *   Lazily renders every artifact at request time and caches the result
 *   in-memory until `invalidate()` runs. Wire it into the Vite plugin
 *   from `@tale/seo/vite-plugin-artifacts`.
 *
 * - **Prod** — {@link createPrecompiledServer}. Reads a `manifest.json`
 *   from a `dist-seo/` directory produced at build time by
 *   {@link compileToDisk} (or the `bin/compile.ts` CLI). No source files
 *   are touched at runtime, so the production Docker image doesn't need
 *   the markdown source tree.
 *
 * Both modes consume the same set of {@link ArtifactPlugin}s (see
 * `plugins/default.ts`), so the output is byte-identical between them.
 *
 * Lower-level builders (`buildLlmsTxt`, `buildSitemap`, …) and the pure
 * `compileArtifacts` helper are also exported so callers that want to
 * write static files (e.g. CI-only snapshot exports) can call them
 * directly.
 */

export { buildLlmsTxt } from './builders/llms-txt';
export type { LlmsTxtPage, LlmsTxtSection } from './builders/llms-txt';

export { buildLlmsFullTxt } from './builders/llms-full-txt';
export type { LlmsFullTxtPage } from './builders/llms-full-txt';

export { buildSitemap, gitMtimeIso } from './builders/sitemap';
export type { SitemapPage } from './builders/sitemap';

export { buildRobotsTxt } from './builders/robots';

export {
  buildOrganizationJsonLd,
  buildWebSiteJsonLd,
  buildArticleJsonLd,
  buildBreadcrumbListJsonLd,
} from './builders/json-ld';
export type { BreadcrumbItem } from './builders/json-ld';

export { pageAsMarkdown } from './builders/page-as-markdown';

export {
  isMdPathname,
  pathnameToRouteUrl,
  routeToMdPath,
  routeToMdUrl,
} from './builders/md-paths';

export { htmlToMarkdown } from './transform/html-to-markdown';

export {
  compileArtifacts,
  compileToDisk,
  compileToMemory,
} from './runtime/compile';
export type {
  CompileArtifactsParams,
  CompiledArtifacts,
  CompileToDiskParams,
  CompileToDiskResult,
  CompileToMemoryParams,
} from './runtime/compile';

export type {
  ArtifactRoute,
  ArtifactSection,
  OptionalPage,
  RobotsConfig,
} from './types';

export type {
  ArtifactPlugin,
  ArtifactResponse,
  BuildContext,
} from './runtime/plugin';
export { defaultPlugins } from './plugins/default';

export { llmsTxtPlugin, LLMS_TXT_PATH } from './plugins/llms-txt';
export { llmsFullTxtPlugin, LLMS_FULL_TXT_PATH } from './plugins/llms-full-txt';
export { sitemapPlugin, SITEMAP_PATH } from './plugins/sitemap';
export { robotsPlugin, ROBOTS_PATH } from './plugins/robots';
export { pageMarkdownPlugin } from './plugins/page-markdown';

export {
  createArtifactsServer,
  createOnDemandServer,
} from './runtime/on-demand-server';
export type {
  ArtifactsServer,
  ArtifactsServerParams,
} from './runtime/on-demand-server';

export {
  createPrecompiledServer,
  createPrecompiledServerFromManifest,
  MANIFEST_FILE,
} from './runtime/precompiled-server';
export type { PrecompiledServerParams } from './runtime/precompiled-server';

export {
  MANIFEST_VERSION,
  readManifest,
  writeManifest,
} from './runtime/manifest';
export type { Manifest, ManifestEntry } from './runtime/manifest';

export { etagOf } from './runtime/etag';

// The Vite plugin is exposed only under the dedicated subpath
// (`@tale/seo/vite-plugin-artifacts`) — Vite is an optional peer
// dependency, so this barrel deliberately doesn't pull it in.

export * from './globals';
