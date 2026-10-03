import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { crawlSite, startSiteServer, type SiteServer } from '@tale/e2e/crawl';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The built site, served by its own server, crawled from the front page, the
 * guides' entry and the agent-facing artifacts through every address the
 * prerendered pages, `llms.txt`, the sitemap and the Markdown exports carry
 * — the addresses the docs frame builds included, which the source-level
 * link lint (`tests/links.test.ts`) cannot see. Runs after `bun run build`
 * (`test:prerender`).
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BUILT = existsSync(join(ROOT, 'dist', 'index.html'));

let server: SiteServer | undefined;

beforeAll(async () => {
  if (BUILT) server = await startSiteServer({ cwd: ROOT });
}, 60_000);
afterAll(() => server?.stop());

describe('built ui-docs site', () => {
  it('has a built dist/ (run ui-docs build first)', () => {
    expect(BUILT).toBe(true);
  });

  it('answers every address its pages and artifacts carry', async () => {
    if (!server) return;
    const report = await crawlSite({
      origin: server.origin,
      aliases: ['https://ui.tale.dev'],
      seeds: [
        '/',
        '/docs',
        '/llms.txt',
        '/llms-full.txt',
        '/sitemap.xml',
        '/robots.txt',
      ],
    });
    expect(report.truncated).toBe(false);
    expect(report.pages).toBeGreaterThan(15);
    expect(report.findings).toEqual([]);
  }, 300_000);
});
