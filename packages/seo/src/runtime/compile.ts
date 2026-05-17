/**
 * Pure artifact compiler — turns a route description into the full set of
 * SEO + LLM files a Tale service serves. Two entry points:
 *
 *   - {@link compileArtifacts}    sync, inline-bodies only, no IO
 *   - {@link compileToMemory}     async, runs the plugin pipeline, may call
 *                                 `loadBody` for routes whose body needs SSR
 *
 * Both return the same `path → content` shape. The on-demand server in
 * {@link createOnDemandServer} also wires the plugins together but caches
 * results per-URL; this module is what callers want when they need the
 * full output set (precompile, CI snapshot, parity tests).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';

import { buildLlmsFullTxt } from '../builders/llms-full-txt';
import { buildLlmsTxt } from '../builders/llms-txt';
import { routeToMdPath, routeToMdUrl } from '../builders/md-paths';
import { pageAsMarkdown } from '../builders/page-as-markdown';
import { buildRobotsTxt } from '../builders/robots';
import { buildSitemap } from '../builders/sitemap';
import { defaultPlugins } from '../plugins/default';
import type {
  ArtifactRoute,
  ArtifactSection,
  OptionalPage,
  ResolvedRoutes,
  RobotsConfig,
} from '../types';
import { etagOf } from './etag';
import { type Manifest, MANIFEST_VERSION, writeManifest } from './manifest';
import type { ArtifactPlugin, BuildContext } from './plugin';

export type {
  ArtifactRoute,
  ArtifactSection,
  OptionalPage,
  RobotsConfig,
} from '../types';

// ---------------------------------------------------------------------------
// Pure layer — `compileArtifacts`
// ---------------------------------------------------------------------------

export interface CompileArtifactsParams {
  /** Absolute base URL (e.g. `https://tale.dev`). */
  siteUrl: string;
  /** llms.txt `# Title`. */
  siteTitle: string;
  /** llms.txt blockquote shown right under the title. */
  siteDescription: string;
  /** Page groups. Flattened into both the sitemap and the llms.txt index. */
  sections: readonly ArtifactSection[];
  /** Cross-link entries listed under llms.txt's trailing `## Optional`. */
  optionalPages?: readonly OptionalPage[];
  /** robots.txt overrides — the main sitemap URL is added automatically. */
  robots?: RobotsConfig;
  /**
   * Emit a `/<route>.md` entry for each route with a `body`. Default true.
   * Disable for services that produce `.md` from a separate prerender step.
   */
  emitPerPageMarkdown?: boolean;
}

export interface CompiledArtifacts {
  /**
   * Map from output-relative path (e.g. `llms.txt`, `legal/privacy.md`)
   * to file contents. Always uses POSIX separators.
   */
  files: ReadonlyMap<string, string>;
}

/**
 * Synchronous in-memory compile. Operates only on inline `route.body`
 * values — for routes whose body must be fetched asynchronously, use
 * {@link compileToMemory} (or write inline bodies upstream).
 *
 * Pure; no IO. Used by tests, CI snapshot exports, and as the inner
 * helper for {@link compileToMemory}.
 */
export function compileArtifacts(
  params: CompileArtifactsParams,
): CompiledArtifacts {
  const {
    siteTitle,
    siteDescription,
    sections,
    optionalPages,
    robots,
    emitPerPageMarkdown = true,
  } = params;
  const siteUrl = params.siteUrl.replace(/\/+$/, '');

  const files = new Map<string, string>();

  const allRoutes = sections.flatMap((s) => s.routes);
  const routesWithBody = allRoutes.filter(
    (r): r is ArtifactRoute & { body: string } => typeof r.body === 'string',
  );

  files.set(
    'llms.txt',
    buildLlmsTxt({
      siteTitle,
      siteDescription,
      sections: sections
        .filter((s) => !s.hideFromIndex)
        .map((s) => ({
          heading: s.heading,
          intro: s.intro,
          pages: s.routes.map((r) => ({
            title: r.title,
            url: `${siteUrl}${routeToMdUrl(r.url)}`,
            description: r.description,
          })),
        })),
      optional: optionalPages,
    }),
  );

  if (routesWithBody.length > 0) {
    files.set(
      'llms-full.txt',
      buildLlmsFullTxt(
        routesWithBody.map((r) => ({
          title: r.title,
          url: `${siteUrl}${r.url}`,
          body: r.body,
        })),
      ),
    );
  }

  if (allRoutes.length > 0) {
    files.set(
      'sitemap.xml',
      buildSitemap(
        allRoutes.map((r) => ({
          url: `${siteUrl}${r.url}`,
          lastModified: r.lastModified,
          alternates: r.alternates,
        })),
      ),
    );
  }

  const sitemapUrls =
    allRoutes.length > 0
      ? [`${siteUrl}/sitemap.xml`, ...(robots?.extraSitemaps ?? [])]
      : (robots?.extraSitemaps ?? []);
  files.set(
    'robots.txt',
    buildRobotsTxt({
      sitemaps: sitemapUrls,
      disallow: robots?.disallow,
      extraDisallow: robots?.extraDisallow,
      userAgent: robots?.userAgent,
    }),
  );

  if (emitPerPageMarkdown) {
    for (const r of routesWithBody) {
      files.set(
        routeToMdPath(r.url),
        pageAsMarkdown({
          frontmatter: {
            title: r.title,
            ...(r.description ? { description: r.description } : {}),
          },
          body: r.body,
          siteUrl,
        }),
      );
    }
  }

  return { files };
}

// ---------------------------------------------------------------------------
// Plugin-driven async layer — `compileToMemory`
// ---------------------------------------------------------------------------

export interface CompileToMemoryParams extends CompileArtifactsParams {
  /**
   * Lazy body fetcher for routes whose `body` isn't inlined in the
   * sections list. Receives the site-relative URL; returns the raw
   * markdown body, or `null` to skip the route.
   */
  loadBody?: (url: string) => Promise<string | null>;
  /** Override the default plugin set. */
  plugins?: readonly ArtifactPlugin[];
}

/**
 * Async in-memory compile. Drives every registered plugin's `enumerate`
 * + `build` and assembles the result into a `path → content` map. Routes
 * may inline `body`; anything else is resolved via `loadBody`.
 *
 * Returns artifacts under their **pathname** form (`/llms.txt`,
 * `/pricing.md`) so the result is shape-compatible with what the
 * on-demand server emits at request time.
 */
export async function compileToMemory(params: CompileToMemoryParams): Promise<
  Map<
    string,
    {
      body: string;
      contentType: string;
      cacheControl: string;
      pluginId: string;
    }
  >
> {
  const { siteUrl, siteTitle, siteDescription, robots, loadBody } = params;
  const plugins = params.plugins ?? defaultPlugins();

  const resolved: ResolvedRoutes = {
    sections: params.sections,
    optionalPages: params.optionalPages,
  };

  const bodyMemo = new Map<string, Promise<string | null>>();
  function bodyFor(url: string): Promise<string | null> {
    const cached = bodyMemo.get(url);
    if (cached) return cached;
    const resolvedBody = (async (): Promise<string | null> => {
      for (const section of resolved.sections) {
        for (const route of section.routes) {
          if (route.url === url && typeof route.body === 'string') {
            return route.body;
          }
        }
      }
      return loadBody ? loadBody(url) : null;
    })();
    bodyMemo.set(url, resolvedBody);
    return resolvedBody;
  }

  const ctx: BuildContext = {
    siteUrl,
    siteTitle,
    siteDescription,
    robots,
    routes: async () => resolved,
    body: bodyFor,
  };

  const out = new Map<
    string,
    {
      body: string;
      contentType: string;
      cacheControl: string;
      pluginId: string;
    }
  >();
  for (const plugin of plugins) {
    const paths = await plugin.enumerate(ctx);
    for (const pathname of paths) {
      const response = await plugin.build(pathname, ctx);
      if (!response) continue;
      const existing = out.get(pathname);
      if (existing) {
        throw new Error(
          `[seo] duplicate artifact path ${pathname}: plugin "${plugin.id}" overlaps with "${existing.pluginId}". Each path must be owned by exactly one plugin.`,
        );
      }
      out.set(pathname, {
        body: response.body,
        contentType: response.contentType,
        cacheControl: response.cacheControl,
        pluginId: plugin.id,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Disk emitter — `compileToDisk`
// ---------------------------------------------------------------------------

export interface CompileToDiskParams extends CompileToMemoryParams {
  /** Absolute path to write into. Created if missing. */
  outDir: string;
}

export interface CompileToDiskResult {
  manifest: Manifest;
  /** Every file emitted, relative to `outDir`, sorted. */
  emittedFiles: readonly string[];
}

/**
 * Materialise the artifact set on disk: every plugin output becomes a
 * file, and a `manifest.json` index records the pathname → file mapping
 * plus precomputed ETags. The output is consumed by
 * `createPrecompiledServer` at request time.
 *
 * Asserts at least `/llms.txt` and `/robots.txt` were emitted — both are
 * always-on artifacts. A missing one signals that the route loader
 * silently returned nothing (typical symptom of a build-stage source
 * tree that wasn't copied) and the CLI should fail loudly rather than
 * ship an empty site.
 */
export async function compileToDisk(
  params: CompileToDiskParams,
): Promise<CompileToDiskResult> {
  const { outDir } = params;
  const compiled = await compileToMemory(params);

  // Fail fast — before any IO — so a silently empty route walk doesn't
  // leave a half-written `dist-seo/` behind for the runtime to load.
  if (!compiled.has('/llms.txt') || !compiled.has('/robots.txt')) {
    throw new Error(
      `[seo] compileToDisk produced an empty artifact set — \`/llms.txt\` and \`/robots.txt\` must both be present. Check that loadRoutes() returned routes.`,
    );
  }

  const entries = [];
  const emittedFiles: string[] = [];
  const knownMdPaths: string[] = [];

  const resolvedOutDir = resolve(outDir);
  for (const [pathname, value] of compiled) {
    // Strip the leading slash for filesystem use.
    const file = pathname.replace(/^\//, '') || 'index';
    const fullPath = resolve(resolvedOutDir, file);
    // Defence-in-depth: a malicious or buggy plugin could enumerate a
    // pathname containing `..` segments. Reject anything that resolves
    // outside the output directory before we touch disk.
    const rel = relative(resolvedOutDir, fullPath);
    if (rel.startsWith(`..${sep}`) || rel === '..' || rel.startsWith('..')) {
      throw new Error(
        `[seo] artifact path ${pathname} (from plugin "${value.pluginId}") escapes outDir; refusing to write.`,
      );
    }
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, value.body, 'utf-8');
    emittedFiles.push(file);

    entries.push({
      path: pathname,
      file,
      pluginId: value.pluginId,
      etag: etagOf(value.body),
      contentType: value.contentType,
      cacheControl: value.cacheControl,
      byteLength: Buffer.byteLength(value.body, 'utf-8'),
    });

    if (pathname.endsWith('.md')) knownMdPaths.push(pathname);
  }

  emittedFiles.sort();
  knownMdPaths.sort();
  entries.sort((a, b) => a.path.localeCompare(b.path));

  const manifest: Manifest = {
    version: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    siteUrl: params.siteUrl.replace(/\/+$/, ''),
    entries,
    knownMdPaths,
  };

  // The per-file write loop above already runs `mkdir` on each file's
  // parent — `outDir` is always one of those parents, so no separate
  // pass needed before writing the manifest.
  await writeManifest(outDir, manifest);

  return { manifest, emittedFiles };
}
