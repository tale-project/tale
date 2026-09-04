import { execFile } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseRenderResults, RENDER_WORKER_SOURCE } from './render_fetch';

/**
 * The worker↔engine protocol, pinned: what the crawl engine does with a page
 * hinges on this mapping — `ok` stores content, `failed` charges the page's
 * fail_count, `not_attempted` leaves the row due for the next link. A
 * malformed record must never look like a success.
 */

const URLS = ['https://a.ch/x', 'https://a.ch/y'] as const;

describe('parseRenderResults', () => {
  it('maps rendered pages, failures, and untouched URLs', () => {
    const results = parseRenderResults(
      {
        pages: [
          {
            url: 'https://a.ch/x',
            attempted: true,
            status: 200,
            finalUrl: 'https://a.ch/x2',
            html: '<html>ok</html>',
          },
          { url: 'https://a.ch/y', attempted: true, error: 'nav timeout' },
        ],
      },
      URLS,
    );
    expect(results.get('https://a.ch/x')).toEqual({
      kind: 'ok',
      status: 200,
      finalUrl: 'https://a.ch/x2',
      html: '<html>ok</html>',
    });
    expect(results.get('https://a.ch/y')).toEqual({
      kind: 'failed',
      reason: 'nav timeout',
    });
  });

  it('treats a URL the worker never reached as not attempted', () => {
    const results = parseRenderResults(
      { pages: [{ url: 'https://a.ch/x', attempted: false }] },
      URLS,
    );
    expect(results.get('https://a.ch/x')).toEqual({ kind: 'not_attempted' });
    expect(results.get('https://a.ch/y')).toEqual({ kind: 'not_attempted' });
  });

  it('never turns a malformed record into a success', () => {
    const results = parseRenderResults(
      {
        pages: [
          // Attempted but no html and no error: failed with a stock reason.
          { url: 'https://a.ch/x', attempted: true, status: 200 },
          // Unknown URL and junk entries: ignored.
          { url: 'https://other.ch/z', attempted: true, html: '<p>' },
          null,
          'garbage',
        ],
      },
      URLS,
    );
    expect(results.get('https://a.ch/x')).toEqual({
      kind: 'failed',
      reason: 'render produced no content',
    });
    expect(results.get('https://a.ch/y')).toEqual({ kind: 'not_attempted' });
    expect(results.size).toBe(2);
  });

  it('survives a payload that is not an object at all', () => {
    for (const payload of [null, 42, 'nope', { pages: 'nope' }]) {
      const results = parseRenderResults(payload, URLS);
      expect(results.get('https://a.ch/x')).toEqual({ kind: 'not_attempted' });
    }
  });
});

/**
 * The staged worker, run for real under node against a fake `playwright-core`
 * that answers every navigation with the same multibyte page. What is pinned:
 * the output file the host reads back is bounded in BYTES, decided before a
 * page is admitted — a page that does not fit is handed back for the next
 * batch instead of being written past the cap.
 */
const FAKE_PLAYWRIGHT = `
const chars = Number(process.env.FAKE_HTML_CHARS || '100');
// 'é' is one UTF-16 code unit but two UTF-8 bytes.
const html = '<html><body>' + 'é'.repeat(chars) + '</body></html>';
function makePage() {
  let current = '';
  return {
    async goto(url) { current = url; return { status: () => 200 }; },
    async waitForLoadState() {},
    async evaluate() { return 42; },
    url() { return current; },
    async content() { return html; },
    async close() {},
  };
}
module.exports = {
  chromium: {
    async launch() {
      return {
        async newContext() { return { async newPage() { return makePage(); } }; },
        async close() {},
      };
    },
  },
};
`;

const NODE_BIN = path.basename(process.execPath).startsWith('node')
  ? process.execPath
  : 'node';
const execFileAsync = promisify(execFile);

describe('render worker — output budget in bytes', () => {
  let root: string;
  let agent: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'render-worker-'));
    agent = path.join(root, 'agent');
    const fakeDir = path.join(agent, 'code', 'node_modules', 'playwright-core');
    mkdirSync(fakeDir, { recursive: true });
    writeFileSync(
      path.join(fakeDir, 'package.json'),
      JSON.stringify({ name: 'playwright-core', main: 'index.js' }),
    );
    writeFileSync(path.join(fakeDir, 'index.js'), FAKE_PLAYWRIGHT);
    // The worker's paths are fixed to /agent inside the sandbox; point them
    // at the temp root here.
    writeFileSync(
      path.join(agent, 'code', 'render.mjs'),
      RENDER_WORKER_SOURCE.replaceAll("'/agent/", `'${agent}/`),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function runWorker(
    urls: readonly string[],
    caps: { maxHtmlBytes: number; maxTotalBytes: number },
    htmlChars: number,
  ): Promise<{ bytes: number; results: Map<string, unknown> }> {
    writeFileSync(
      path.join(agent, 'code', 'urls.json'),
      JSON.stringify({
        urls,
        perPageTimeoutMs: 10,
        idleTimeoutMs: 10,
        softBudgetMs: 60_000,
        ...caps,
      }),
    );
    await execFileAsync(NODE_BIN, [path.join(agent, 'code', 'render.mjs')], {
      env: { ...process.env, FAKE_HTML_CHARS: String(htmlChars) },
      timeout: 25_000,
    });
    const raw = readFileSync(path.join(agent, 'output', 'pages.json'));
    const payload: unknown = JSON.parse(raw.toString('utf8'));
    return {
      bytes: raw.byteLength,
      results: parseRenderResults(payload, urls),
    };
  }

  // Regression: the batch total was `html.length` summed AFTER storing each
  // page and checked only before the NEXT one, so pages.json could exceed the
  // host's read cap (and by more with multibyte text) — the host then saw no
  // output and the crawl retried the same batch forever.
  it('keeps pages.json under maxTotalBytes and hands back the page that would not fit', async () => {
    const urls = ['a', 'b', 'c', 'd'].map((p) => `https://site.example/${p}`);
    // 1700 chars = 3400 UTF-8 bytes per page: two fit under 10 000, the third
    // would not.
    const { bytes, results } = await runWorker(
      urls,
      { maxHtmlBytes: 4_000, maxTotalBytes: 10_000 },
      1_700,
    );
    expect(bytes).toBeLessThanOrEqual(10_000);
    expect(results.get(urls[0] ?? '')).toMatchObject({
      kind: 'ok',
      status: 200,
    });
    expect(results.get(urls[1] ?? '')).toMatchObject({
      kind: 'ok',
      status: 200,
    });
    // Not written past the cap, not charged as a failure: due next batch.
    expect(results.get(urls[2] ?? '')).toEqual({ kind: 'not_attempted' });
    expect(results.get(urls[3] ?? '')).toEqual({ kind: 'not_attempted' });
  }, 30_000);

  it('applies the per-page bound in bytes, not UTF-16 code units', async () => {
    const urls = ['https://site.example/big'];
    // 1700 code units pass a 3000 "length" check but are 3400 bytes.
    const { results } = await runWorker(
      urls,
      { maxHtmlBytes: 3_000, maxTotalBytes: 100_000 },
      1_700,
    );
    expect(results.get(urls[0] ?? '')).toEqual({
      kind: 'failed',
      reason: 'rendered HTML exceeds the per-page bound',
    });
  }, 30_000);
});
