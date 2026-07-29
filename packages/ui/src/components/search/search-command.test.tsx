import { fireEvent, screen, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import ICU from 'i18next-icu';
import { useEffect, useState } from 'react';
import { initReactI18next } from 'react-i18next';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import enMessages from '../../i18n/messages/en.yml';
import { SearchCommand } from './search-command';
import type { SearchResult, SearchSource, SearchSourceState } from './types';

// Assert against the shipped translation values rather than hardcoded English
// copy, so a copy tweak or locale-wiring change can't break these tests for the
// wrong reason (project rule: never compare against an English literal).
const L = enMessages.search;

// --- a controllable mock source ------------------------------------------
type MockMode =
  | { kind: 'ready'; results: SearchResult[] }
  | { kind: 'loading' }
  | { kind: 'error' };

let respond: (query: string) => MockMode = () => ({
  kind: 'ready',
  results: [],
});

// Stable module-scope source (a hook). Identity never changes, so the order
// of hooks it calls is stable across renders — the SearchSource contract.
// Named with a `use` prefix so the rules-of-hooks lint recognises it.
function useMockSource(query: string): SearchSourceState {
  const [state, setState] = useState<SearchSourceState>({
    results: [],
    status: 'idle',
  });
  useEffect(() => {
    if (!query) {
      setState({ results: [], status: 'idle' });
      return;
    }
    const r = respond(query);
    if (r.kind === 'loading') setState({ results: [], status: 'loading' });
    else if (r.kind === 'error')
      setState({ results: [], status: 'error', error: new Error('boom') });
    else setState({ results: r.results, status: 'ready' });
  }, [query]);
  return state;
}
const mockSource: SearchSource = useMockSource;

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'a',
    title: 'Configuration',
    href: '/platform/configuration',
    group: 'platform',
    body: 'config body',
    matchedTerms: ['configuration'],
    queryTerms: ['config'],
    match: { configuration: ['title'] },
    ...overrides,
  };
}

beforeAll(async () => {
  if (!i18next.isInitialized) {
    await i18next
      .use(ICU)
      .use(initReactI18next)
      .init({
        lng: 'en',
        fallbackLng: 'en',
        resources: { en: enMessages },
        interpolation: { escapeValue: false, prefix: '{', suffix: '}' },
        react: { useSuspense: false },
      });
  }
});

beforeEach(() => {
  respond = () => ({ kind: 'ready', results: [] });
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function renderCommand(
  props: Partial<Parameters<typeof SearchCommand>[0]> = {},
) {
  const onOpenChange = props.onOpenChange ?? vi.fn();
  const onSelect = props.onSelect ?? vi.fn();
  const utils = render(
    <SearchCommand
      open
      onOpenChange={onOpenChange}
      onSelect={onSelect}
      source={mockSource}
      debounceMs={0}
      recentsStorageKey="tale.test.recentSearches.v1"
      {...props}
    />,
  );
  return { ...utils, onOpenChange, onSelect };
}

describe('SearchCommand', () => {
  it('renders the search input from the i18n placeholder', () => {
    renderCommand();
    expect(screen.getByPlaceholderText(L.placeholder)).toBeInTheDocument();
  });

  it('shows the empty state when the query is empty', () => {
    renderCommand();
    expect(screen.getByText(L.empty)).toBeInTheDocument();
  });

  it('shows the "keep typing" hint below minQueryLength', async () => {
    const { user } = renderCommand();
    await user.type(screen.getByPlaceholderText(L.placeholder), 'a');
    expect(screen.getByText(L.keepTyping)).toBeInTheDocument();
  });

  it('renders results once the query reaches minQueryLength', async () => {
    respond = () => ({ kind: 'ready', results: [result({ id: '1' })] });
    const { user } = renderCommand();
    await user.type(screen.getByPlaceholderText(L.placeholder), 'config');
    await waitFor(() =>
      expect(screen.getByText('Configuration')).toBeInTheDocument(),
    );
  });

  it('renders the no-results state when the source returns []', async () => {
    respond = () => ({ kind: 'ready', results: [] });
    const { user } = renderCommand();
    await user.type(screen.getByPlaceholderText(L.placeholder), 'xyz');
    await waitFor(() =>
      expect(screen.getByText(L.noResultsTitle)).toBeInTheDocument(),
    );
  });

  it('shows the skeleton while loading with no stale results', async () => {
    respond = () => ({ kind: 'loading' });
    const { user } = renderCommand();
    await user.type(screen.getByPlaceholderText(L.placeholder), 'config');
    await waitFor(() =>
      expect(screen.getByTestId('search-skeleton')).toBeInTheDocument(),
    );
  });

  it('selects on Enter, closes and reports the result', async () => {
    respond = () => ({
      kind: 'ready',
      results: [result({ id: '1', href: '/foo' })],
    });
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    const { user } = renderCommand({ onSelect, onOpenChange });
    await user.type(screen.getByPlaceholderText(L.placeholder), 'config');
    await waitFor(() => screen.getByRole('option'));
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ href: '/foo' }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('navigates rows in DOM (visual) order when groups interleave by score', async () => {
    respond = () => ({
      kind: 'ready',
      results: [
        result({ id: 'a1', title: 'A1', group: 'alpha', href: '/a/1' }),
        result({ id: 'b1', title: 'B1', group: 'bravo', href: '/b/1' }),
        result({ id: 'a2', title: 'A2', group: 'alpha', href: '/a/2' }),
        result({ id: 'b2', title: 'B2', group: 'bravo', href: '/b/2' }),
      ],
    });
    const { user } = renderCommand();
    await user.type(screen.getByPlaceholderText(L.placeholder), 'foo');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(4));
    // Grouping clusters alpha then bravo: A1, A2, B1, B2.
    const titles = screen
      .getAllByRole('option')
      .map((o) => o.querySelector('.min-w-0 > span')?.textContent);
    expect(titles).toEqual(['A1', 'A2', 'B1', 'B2']);

    await user.keyboard('{ArrowDown}'); // → A2 (visual index 1)
    const active = screen
      .getAllByRole('option')
      .findIndex((o) => o.getAttribute('aria-selected') === 'true');
    expect(active).toBe(1);
  });

  it('Enter navigates the visually-selected row, not the score-ordered one', async () => {
    respond = () => ({
      kind: 'ready',
      results: [
        result({ id: 'a1', title: 'A1', group: 'alpha', href: '/a/1' }),
        result({ id: 'b1', title: 'B1', group: 'bravo', href: '/b/1' }),
        result({ id: 'a2', title: 'A2', group: 'alpha', href: '/a/2' }),
      ],
    });
    const onSelect = vi.fn();
    const { user } = renderCommand({ onSelect });
    await user.type(screen.getByPlaceholderText(L.placeholder), 'foo');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
    // Visual order: A1, A2, B1 → ArrowDown twice = B1.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ href: '/b/1' }),
    );
  });

  it('does not crash on arrow keys with no results', () => {
    renderCommand();
    const input = screen.getByPlaceholderText(L.placeholder);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toBeInTheDocument();
  });

  it('saves a recent search (with href) after selecting a result', async () => {
    respond = () => ({
      kind: 'ready',
      results: [result({ id: '1', title: 'Configuration', href: '/cfg' })],
    });
    const { user } = renderCommand();
    await user.type(screen.getByPlaceholderText(L.placeholder), 'config');
    await waitFor(() => screen.getByRole('option'));
    await user.keyboard('{Enter}');
    const stored = JSON.parse(
      window.localStorage.getItem('tale.test.recentSearches.v1') ?? '[]',
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].query).toBe('config');
    expect(stored[0].href).toBe('/cfg');
  });

  it('applies label overrides over the i18n defaults', () => {
    renderCommand({
      labels: { empty: 'Custom empty copy.', placeholder: 'Find anything' },
    });
    expect(screen.getByText('Custom empty copy.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Find anything')).toBeInTheDocument();
  });

  it('renders a localized error state when the source fails', async () => {
    respond = () => ({ kind: 'error' });
    const { user } = renderCommand();
    await user.type(screen.getByPlaceholderText(L.placeholder), 'config');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(L.errorTitle),
    );
    // An error must not masquerade as loading or as an empty result set.
    expect(screen.queryByTestId('search-skeleton')).not.toBeInTheDocument();
    expect(screen.queryByText(L.noResultsTitle)).not.toBeInTheDocument();
  });

  it('fills the query when a recent search is picked', async () => {
    window.localStorage.setItem(
      'tale.test.recentSearches.v1',
      JSON.stringify([{ query: 'previous query', savedAt: 1 }]),
    );
    const { user } = renderCommand();
    await user.click(screen.getByText('previous query'));
    expect(screen.getByPlaceholderText(L.placeholder)).toHaveValue(
      'previous query',
    );
  });

  it('removes a single recent and clears the rest', async () => {
    window.localStorage.setItem(
      'tale.test.recentSearches.v1',
      JSON.stringify([
        { query: 'alpha', savedAt: 2 },
        { query: 'beta', savedAt: 1 },
      ]),
    );
    const { user } = renderCommand();
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();

    await user.click(screen.getAllByLabelText(L.removeRecent)[0]);
    expect(screen.queryByText('alpha')).not.toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();

    await user.click(screen.getByText(L.clearRecent));
    expect(screen.queryByText('beta')).not.toBeInTheDocument();
    expect(screen.getByText(L.empty)).toBeInTheDocument();
  });

  it('labels the catch-all group when results have no group', async () => {
    respond = () => ({
      kind: 'ready',
      results: [result({ id: '1', group: undefined })],
    });
    const { user } = renderCommand();
    await user.type(screen.getByPlaceholderText(L.placeholder), 'config');
    await waitFor(() =>
      expect(screen.getByText(L.resultsGroup)).toBeInTheDocument(),
    );
  });

  it('renders nothing when closed', () => {
    renderCommand({ open: false });
    expect(
      screen.queryByPlaceholderText(L.placeholder),
    ).not.toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit when open on the empty state', async () => {
      const { container } = renderCommand();
      await checkAccessibility(container);
    });

    it('marks the content as a modal dialog (aria-modal)', () => {
      renderCommand();
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });
  });
});
