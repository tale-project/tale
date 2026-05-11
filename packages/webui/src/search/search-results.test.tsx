import { render, screen } from '@testing-library/react';
import type { RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  groupBySection,
  SearchResults,
  urlToBreadcrumb,
} from './search-results';
import type { SearchResult } from './types';

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'id-1',
    title: 'Configuration',
    url: '/platform/configuration',
    section: 'platform',
    body: 'The configuration is loaded from environment variables.',
    score: 5,
    matchedTerms: ['configuration'],
    queryTerms: ['config'],
    match: { configuration: ['title', 'body'] },
    ...overrides,
  };
}

interface RenderProps {
  results: SearchResult[];
  terms?: string[];
  activeIndex?: number;
  sectionLabel?: (key: string) => string;
}

function renderResults({
  results,
  terms = [],
  activeIndex = 0,
  sectionLabel,
}: RenderProps) {
  const optionRefs: RefObject<Array<HTMLButtonElement | null>> = {
    current: [],
  };
  const setActive = vi.fn();
  const onSelect = vi.fn();
  const utils = render(
    <SearchResults
      results={results}
      terms={terms}
      activeIndex={activeIndex}
      setActiveIndex={setActive}
      onSelect={onSelect}
      optionIdPrefix="opt"
      optionRefs={optionRefs}
      sectionLabel={sectionLabel}
    />,
  );
  return { ...utils, setActive, onSelect };
}

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

  it('uses the supplied sectionLabel for the first segment', () => {
    expect(
      urlToBreadcrumb('/self-hosted/configuration/retention', (key) =>
        key === 'self-hosted' ? 'Self-hosted' : key,
      ),
    ).toEqual(['Self-hosted', 'Configuration']);
  });

  it('keeps the only segment when the URL is one level deep', () => {
    expect(urlToBreadcrumb('/cloud')).toEqual(['Cloud']);
  });

  it('returns [] for the site root', () => {
    expect(urlToBreadcrumb('/')).toEqual([]);
    expect(urlToBreadcrumb('')).toEqual([]);
  });

  it('strips a host prefix before parsing', () => {
    expect(
      urlToBreadcrumb('https://docs.example.com/platform/agents/create'),
    ).toEqual(['Platform', 'Agents']);
  });
});

describe('groupBySection', () => {
  it('groups results by section, preserving flatIndex for keyboard nav glue', () => {
    const groups = groupBySection([
      makeResult({ id: 'a', section: 'platform' }),
      makeResult({ id: 'b', section: 'cli' }),
      makeResult({ id: 'c', section: 'platform' }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['platform', 'cli']);
    expect(groups[0].items.map((i) => i.flatIndex)).toEqual([0, 2]);
    expect(groups[1].items.map((i) => i.flatIndex)).toEqual([1]);
  });

  it('uses a custom sectionLabel when provided', () => {
    const groups = groupBySection([makeResult({ section: 'platform' })], (k) =>
      k.toUpperCase(),
    );
    expect(groups[0].label).toBe('PLATFORM');
  });

  it('humanises hyphenated/underscored section keys', () => {
    const groups = groupBySection([
      makeResult({ id: 'a', section: 'getting-started' }),
      makeResult({ id: 'b', section: 'admin_panel' }),
    ]);
    expect(groups[0].label).toBe('Getting Started');
    expect(groups[1].label).toBe('Admin Panel');
  });

  it('falls back to "Docs" for results with no section', () => {
    const groups = groupBySection([makeResult({ section: undefined })]);
    expect(groups[0].label).toBe('Docs');
  });
});

describe('SearchResults rendering', () => {
  it('renders one row per result with the title', () => {
    renderResults({
      results: [
        makeResult({ id: 'a', title: 'Configuration' }),
        makeResult({ id: 'b', title: 'RAG service' }),
      ],
    });
    expect(screen.getByText('Configuration')).toBeInTheDocument();
    expect(screen.getByText('RAG service')).toBeInTheDocument();
  });

  it('marks the active option with aria-selected="true"', () => {
    renderResults({
      results: [makeResult({ id: 'a' }), makeResult({ id: 'b' })],
      activeIndex: 1,
    });
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('highlights the per-result matchedTerms — proving the fix for config→configuration', () => {
    renderResults({
      results: [
        makeResult({
          matchedTerms: ['configuration'],
          queryTerms: ['config'],
        }),
      ],
    });
    // The matched index term "configuration" should be wrapped in <mark>.
    const marks = document.querySelectorAll('mark');
    const markedText = Array.from(marks).map((m) => m.textContent);
    expect(markedText).toContain('configuration');
  });

  it('highlights the full longer term when MiniSearch returns both prefix forms', () => {
    // Regression: when MiniSearch returns BOTH "config" and "configuration"
    // for a prefix search, Highlight must mark the entire "configuration"
    // (not just "config" with "uration" trailing un-marked).
    renderResults({
      results: [
        makeResult({
          title: 'Retention configuration',
          body: 'A central configuration applies across data domains.',
          matchedTerms: ['config', 'configuration'],
          queryTerms: ['config'],
        }),
      ],
    });
    const marks = Array.from(document.querySelectorAll('mark')).map(
      (m) => m.textContent,
    );
    // No mark should be a literal "config" sitting inside "configuration".
    expect(marks).toContain('configuration');
    expect(marks).not.toContain('config');
  });

  it('omits the snippet when the result has no body', () => {
    renderResults({
      results: [
        makeResult({ body: undefined, matchedTerms: [], queryTerms: [] }),
      ],
    });
    // Title still present; no extracted snippet text from the empty body.
    expect(screen.getByText('Configuration')).toBeInTheDocument();
  });

  it('falls back to the supplied terms when a result has no matchedTerms', () => {
    renderResults({
      results: [
        makeResult({ matchedTerms: [], queryTerms: [], title: 'Welcome' }),
      ],
      terms: ['welcome'],
    });
    const marks = document.querySelectorAll('mark');
    const markedText = Array.from(marks).map((m) => m.textContent);
    expect(markedText).toContain('Welcome');
  });

  it('uses Hash icon when the match fired on headings, FileText when body-only, Type when title', () => {
    renderResults({
      results: [
        makeResult({
          id: 'title',
          title: 'Title hit',
          match: { x: ['title'] },
        }),
        makeResult({
          id: 'heading',
          title: 'Heading hit',
          match: { x: ['headings'] },
        }),
        makeResult({
          id: 'body',
          title: 'Body hit',
          match: { x: ['body'] },
        }),
      ],
    });
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('data-match-kind', 'title');
    expect(options[1]).toHaveAttribute('data-match-kind', 'heading');
    expect(options[2]).toHaveAttribute('data-match-kind', 'body');
  });

  it('calls onSelect when a row is clicked', async () => {
    const { onSelect } = renderResults({
      results: [makeResult({ id: 'a' })],
    });
    const option = screen.getByRole('option');
    option.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('groups visually by section', () => {
    renderResults({
      results: [
        makeResult({ id: 'a', section: 'platform', title: 'P1' }),
        makeResult({ id: 'b', section: 'cli', title: 'C1' }),
      ],
      sectionLabel: (k) => `Section: ${k}`,
    });
    // Both the group header AND the breadcrumb now use sectionLabel — find
    // them by the uppercase-styling on the header to disambiguate.
    const headers = document.querySelectorAll('.uppercase');
    const headerTexts = Array.from(headers).map((h) => h.textContent);
    expect(headerTexts).toContain('Section: platform');
    expect(headerTexts).toContain('Section: cli');
  });

  it('renders a breadcrumb for each result', () => {
    renderResults({
      results: [
        makeResult({
          id: 'a',
          url: '/self-hosted/configuration/retention',
          section: 'self-hosted',
        }),
      ],
    });
    // Breadcrumb sits inside a span with the URL as aria-label; assert its
    // text content rather than rely on visible text matching (which collides
    // with the group header).
    const crumb = document.querySelector(
      `[aria-label="/self-hosted/configuration/retention"]`,
    );
    expect(crumb?.textContent).toContain('Self Hosted');
    expect(crumb?.textContent).toContain('Configuration');
  });

  it('builds optionId-N ids stable with flatIndex', () => {
    renderResults({
      results: [makeResult({ id: 'a' }), makeResult({ id: 'b' })],
    });
    const options = screen.getAllByRole('option');
    expect(options[0].id).toBe('opt-0');
    expect(options[1].id).toBe('opt-1');
  });
});
