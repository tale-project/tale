import { describe, expect, it } from 'vitest';

import { slugLabel, suggestPages } from './suggest-pages';

const PAGES = [
  { slug: 'index' },
  { slug: 'platform/chat/basics' },
  { slug: 'platform/chat/arena-mode' },
  { slug: 'self-hosted/install/quickstart' },
  { slug: 'self-hosted/configuration/providers' },
  { slug: 'develop/api-reference' },
];

describe('suggestPages', () => {
  it('ranks the page one typo away first', () => {
    const [first] = suggestPages('platform/chat/basic', PAGES);
    expect(first?.slug).toBe('platform/chat/basics');
  });

  it('matches on the last segment when the section moved', () => {
    const [first] = suggestPages('install/quickstart', PAGES);
    expect(first?.slug).toBe('self-hosted/install/quickstart');
  });

  it('keeps navigation order for the site root', () => {
    expect(suggestPages('', PAGES, 2).map((p) => p.slug)).toEqual([
      'index',
      'platform/chat/basics',
    ]);
  });

  it('returns at most `max` pages and never invents one', () => {
    const picks = suggestPages('quickstart', PAGES, 3);
    expect(picks).toHaveLength(3);
    for (const pick of picks) expect(PAGES).toContain(pick);
  });
});

describe('slugLabel', () => {
  it('title-cases every segment and drops a section index', () => {
    expect(slugLabel('platform/chat/arena-mode')).toBe(
      'Platform / Chat / Arena Mode',
    );
    expect(slugLabel('self-hosted/install/index')).toBe(
      'Self Hosted / Install',
    );
  });
});
