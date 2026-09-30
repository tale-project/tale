import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { crawlSite, startSiteServer, type SiteServer } from '@tale/e2e/crawl';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The built site, served by its own server, crawled the way a link checker,
 * a search engine or a language model reads it: from the locale homes and
 * the agent-facing artifacts, through every address the prerendered pages,
 * `llms.txt`, the sitemap and the Markdown exports carry. Catches what the
 * source-level link lint (`tests/links.test.ts`) cannot see — addresses the
 * docs frame builds (rail, breadcrumbs, prev/next, alternates, footer), an
 * artifact listing a page the server does not answer, a rendered page
 * missing the id a link names. Runs after `bun run build` (`test:prerender`).
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BUILT = existsSync(join(ROOT, 'dist', 'index.html'));

let server: SiteServer | undefined;

beforeAll(async () => {
  if (BUILT) server = await startSiteServer({ cwd: ROOT });
}, 60_000);
afterAll(() => server?.stop());

describe('built docs site', () => {
  it('has a built dist/ (run docs build first)', () => {
    expect(BUILT).toBe(true);
  });

  it('answers every address its pages and artifacts carry', async () => {
    if (!server) return;
    const report = await crawlSite({
      origin: server.origin,
      aliases: ['https://docs.tale.dev'],
      seeds: [
        '/',
        '/de',
        '/fr',
        '/llms.txt',
        '/llms-full.txt',
        '/sitemap.xml',
        '/robots.txt',
      ],
    });
    expect(report.truncated).toBe(false);
    expect(report.pages).toBeGreaterThan(400);
    expect(report.findings).toEqual([]);
  }, 300_000);
});
