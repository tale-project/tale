import { describe, expect, it } from 'vitest';

import {
  CRAWLER_INFO_URL,
  CRAWLER_PRODUCT_TOKEN,
  crawlerRequestHeaders,
  crawlerUserAgent,
} from './crawler_identity';

/**
 * The crawler introduced itself as `node` — Node's fetch default — so a
 * site owner could neither name it in robots.txt nor tell it from a scraper
 * (2026-09-15 evaluation, i6). The string is the contract the docs quote.
 */
describe('crawlerUserAgent', () => {
  it('is the product token, the deployment version and the info URL', () => {
    expect(crawlerUserAgent('0.5.27')).toBe(
      'TaleBot/0.5.27 (+https://docs.tale.dev/platform/knowledge/crawling)',
    );
    expect(CRAWLER_PRODUCT_TOKEN).toBe('TaleBot');
    expect(CRAWLER_INFO_URL).toBe(
      'https://docs.tale.dev/platform/knowledge/crawling',
    );
  });

  it('reads `dev` when the deployment has no version', () => {
    expect(crawlerUserAgent(undefined)).toBe(
      `TaleBot/dev (+${CRAWLER_INFO_URL})`,
    );
    expect(crawlerUserAgent('')).toBe(`TaleBot/dev (+${CRAWLER_INFO_URL})`);
  });

  it('never lets a build label break the header value', () => {
    const agent = crawlerUserAgent('0.5.27 beta\r\nX-Injected: 1');
    expect(agent).toMatch(
      /^TaleBot\/[0-9A-Za-z.+-]+ \(\+https:\/\/docs\.tale\.dev\/platform\/knowledge\/crawling\)$/,
    );
    expect(agent).not.toMatch(/[\r\n\s:]/.source.replace('\\s', '\\s(?! \\()'));
  });
});

describe('crawlerRequestHeaders', () => {
  it('carries the agent under User-Agent, from the deployment version', () => {
    expect(crawlerRequestHeaders('1.2.3')).toEqual({
      'User-Agent':
        'TaleBot/1.2.3 (+https://docs.tale.dev/platform/knowledge/crawling)',
    });
  });
});
