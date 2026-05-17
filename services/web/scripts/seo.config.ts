/**
 * Build-time SEO config for the marketing site. Consumed by
 * `tale-seo-compile` (`@tale/seo/bin/compile`) during the Docker builder
 * stage to materialise `dist-seo/`.
 *
 * Marketing routes need the prebuilt SSR bundle at
 * `dist-ssr/entry-server.js` to render — the docs Dockerfile orders the
 * compile step after `vite build --ssr` so that file exists when the
 * config loads.
 *
 * Legal routes read directly from `app/content/legal/{en,de,fr}/*.md`
 * (still present in the builder stage).
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { CompileToDiskParams } from '@tale/seo';
import { TALE_DOCS_URL, TALE_SITE_URL } from '@tale/seo/globals';

import {
  buildWebSections,
  makeWebLoadBody,
  WEB_SITE_DESCRIPTION,
  WEB_SITE_TITLE,
  webOptionalPages,
  type SsrRenderer,
} from '../lib/seo/build';
import { enumerateLegalRoutes } from './legal-routes';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SSR_BUNDLE_PATH = resolve(
  SCRIPT_DIR,
  '..',
  'dist-ssr',
  'entry-server.js',
);

interface SsrBundleModule {
  render: (url: string) => Promise<{ html: string }>;
}

async function loadSsrRenderer(): Promise<SsrRenderer> {
  const mod: SsrBundleModule = await import(
    pathToFileURL(SSR_BUNDLE_PATH).href
  );
  return { render: (url) => mod.render(url) };
}

export default async function webSeoConfig(): Promise<
  Omit<CompileToDiskParams, 'outDir'>
> {
  const ssr = await loadSsrRenderer();
  return {
    siteUrl: TALE_SITE_URL,
    siteTitle: WEB_SITE_TITLE,
    siteDescription: WEB_SITE_DESCRIPTION,
    sections: buildWebSections(await enumerateLegalRoutes()),
    optionalPages: webOptionalPages(),
    loadBody: makeWebLoadBody(ssr),
    robots: {
      extraSitemaps: [`${TALE_DOCS_URL}/sitemap.xml`],
    },
  };
}
