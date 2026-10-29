import { describe, expect, it } from 'vitest';

import {
  FALLBACK_GROUP,
  flattenGroups,
  groupResults,
  humanizeGroupKey,
  urlToBreadcrumb,
} from './group-by';
import type { SearchResult } from './types';

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'id-1',
    title: 'Configuration',
    group: 'platform',
    ...overrides,
  };
}

describe('groupResults', () => {
  it('groups by group key, assigning sequential visualIndex in DOM order', () => {
    const groups = groupResults([
      makeResult({ id: 'a', group: 'platform' }),
      makeResult({ id: 'b', group: 'cli' }),
      makeResult({ id: 'c', group: 'platform' }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['platform', 'cli']);
    // Items cluster by group, and visualIndex follows the rendered order:
    // platform(a,c) then cli(b) → a=0, c=1, b=2.
    expect(groups[0]?.items.map((i) => i.visualIndex)).toEqual([0, 1]);
    expect(groups[1]?.items.map((i) => i.visualIndex)).toEqual([2]);
  });

  it('flattenGroups returns results in visual (DOM) order', () => {
    const groups = groupResults([
      makeResult({ id: 'a', group: 'platform', title: 'A' }),
      makeResult({ id: 'b', group: 'cli', title: 'B' }),
      makeResult({ id: 'c', group: 'platform', title: 'C' }),
    ]);
    expect(flattenGroups(groups).map((r) => r.title)).toEqual(['A', 'C', 'B']);
  });

  it('uses a custom getGroupLabel when provided', () => {
    const groups = groupResults(
      [makeResult({ group: 'platform' })],
      undefined,
      (k) => k.toUpperCase(),
    );
    expect(groups[0]?.label).toBe('PLATFORM');
  });

  it('humanises hyphenated/underscored group keys by default', () => {
    expect(humanizeGroupKey('getting-started')).toBe('Getting Started');
    expect(humanizeGroupKey('admin_panel')).toBe('Admin Panel');
  });

  it('clusters group-less results under the single fallback group key', () => {
    const groups = groupResults([
      makeResult({ id: 'a', group: undefined }),
      makeResult({ id: 'b', group: undefined }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe(FALLBACK_GROUP);
  });

  it('localises the fallback group label through getGroupLabel (no baked-in copy)', () => {
    // The catch-all label is the caller's responsibility — the command passes a
    // resolver that returns the translated `resultsGroup` string for this key.
    const groups = groupResults(
      [makeResult({ group: undefined })],
      undefined,
      (key) => (key === FALLBACK_GROUP ? 'Résultats' : humanizeGroupKey(key)),
    );
    expect(groups[0]?.label).toBe('Résultats');
  });
});

describe('urlToBreadcrumb', () => {
  it('drops the last segment (page slug) and humanises the rest', () => {
    expect(urlToBreadcrumb('/self-hosted/configuration/retention')).toEqual([
      'Self Hosted',
      'Configuration',
    ]);
  });

  it('drops a leading 2-letter locale segment', () => {
    expect(urlToBreadcrumb('/de/platform/configuration/retention')).toEqual([
      'Platform',
      'Configuration',
    ]);
  });

  it('uses the supplied segmentLabel for the first segment', () => {
    expect(
      urlToBreadcrumb('/self-hosted/configuration/retention', (key) =>
        key === 'self-hosted' ? 'Self-hosted' : key,
      ),
    ).toEqual(['Self-hosted', 'Configuration']);
  });

  it('keeps the only segment when the URL is one level deep', () => {
    expect(urlToBreadcrumb('/cloud')).toEqual(['Cloud']);
  });

  it('returns [] for the site root and undefined', () => {
    expect(urlToBreadcrumb('/')).toEqual([]);
    expect(urlToBreadcrumb('')).toEqual([]);
    expect(urlToBreadcrumb(undefined)).toEqual([]);
  });

  it('strips a host prefix before parsing', () => {
    expect(
      urlToBreadcrumb('https://docs.example.com/platform/agents/create'),
    ).toEqual(['Platform', 'Agents']);
  });

  it('treats any 2-letter leading segment as a locale prefix', () => {
    // Known limitation: the locale strip is length-based, not allow-list-based,
    // so a hypothetical 2-letter top-level section is dropped too. No real docs
    // path hits this today (the shortest section, `cli`, is three letters).
    expect(urlToBreadcrumb('/ui/components/button')).toEqual(['Components']);
  });
});
