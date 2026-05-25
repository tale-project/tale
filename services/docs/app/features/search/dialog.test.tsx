import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as client from './client';
import { SearchDialog } from './dialog';
import type { SearchResult } from './types';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}));

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'a',
    title: 'Configuration',
    url: '/platform/configuration',
    section: 'platform',
    body: 'config body',
    score: 5,
    matchedTerms: ['configuration'],
    queryTerms: ['config'],
    match: { configuration: ['title'] },
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(client, 'loadIndex').mockResolvedValue(
    // oxlint-disable-next-line typescript/no-explicit-any -- dialog only awaits, never reads
    {} as any,
  );
  // jsdom doesn't implement scrollIntoView on HTMLElement.
  Element.prototype.scrollIntoView = vi.fn();
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function renderDialog(props: Partial<Parameters<typeof SearchDialog>[0]> = {}) {
  const onOpenChange = props.onOpenChange ?? vi.fn();
  const utils = render(
    <SearchDialog locale="en" open onOpenChange={onOpenChange} {...props} />,
  );
  return { ...utils, onOpenChange };
}

describe('SearchDialog', () => {
  it('renders the search input when open', () => {
    renderDialog();
    expect(
      screen.getByPlaceholderText('Search documentation…'),
    ).toBeInTheDocument();
  });

  it('shows the empty state with the default copy when the query is empty', () => {
    renderDialog();
    expect(
      screen.getByText('Start typing to search the docs.'),
    ).toBeInTheDocument();
  });

  it('shows the "keep typing" hint when the query is below minQueryLength', async () => {
    const user = userEvent.setup();
    renderDialog();
    const input = screen.getByPlaceholderText('Search documentation…');
    await user.type(input, 'a');
    expect(screen.getByText('Keep typing to search…')).toBeInTheDocument();
  });

  it('runs a search and renders results once the query reaches minQueryLength', async () => {
    vi.spyOn(client, 'search').mockResolvedValue([
      makeResult({ id: '1', title: 'Configuration' }),
    ]);
    const user = userEvent.setup();
    renderDialog();
    const input = screen.getByPlaceholderText('Search documentation…');
    await user.type(input, 'config');
    await waitFor(() => {
      expect(screen.getByText('Configuration')).toBeInTheDocument();
    });
  });

  it('renders the no-results state when the search returns []', async () => {
    vi.spyOn(client, 'search').mockResolvedValue([]);
    const user = userEvent.setup();
    renderDialog();
    await user.type(
      screen.getByPlaceholderText('Search documentation…'),
      'xyz',
    );
    await waitFor(() => {
      expect(screen.getByText('No results.')).toBeInTheDocument();
    });
  });

  it('navigates and closes on Enter when a result is selected', async () => {
    navigate.mockClear();
    vi.spyOn(client, 'search').mockResolvedValue([
      makeResult({ id: '1', url: '/foo' }),
    ]);
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onOpenChange });

    const input = screen.getByPlaceholderText('Search documentation…');
    await user.type(input, 'config');
    await waitFor(() => screen.getByRole('option'));
    await user.keyboard('{Enter}');

    expect(navigate).toHaveBeenCalledWith({ to: '/foo' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('moves the active option with ArrowDown / ArrowUp', async () => {
    vi.spyOn(client, 'search').mockResolvedValue([
      makeResult({ id: '1', title: 'A' }),
      makeResult({ id: '2', title: 'B', section: 'cli' }),
    ]);
    const user = userEvent.setup();
    renderDialog();

    const input = screen.getByPlaceholderText('Search documentation…');
    await user.type(input, 'rag');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));

    // First option starts active.
    let options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowDown}');
    options = screen.getAllByRole('option');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowDown}'); // stays at end
    options = screen.getAllByRole('option');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowUp}');
    options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowUp}'); // stays at top
    options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('does not crash on arrow keys when no results are present', async () => {
    renderDialog();
    const input = screen.getByPlaceholderText('Search documentation…');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    // No exception — input still in the DOM.
    expect(input).toBeInTheDocument();
  });

  it('uses the supplied label overrides', () => {
    renderDialog({
      labels: {
        empty: 'Custom empty copy.',
        placeholder: 'Find anything',
      },
    });
    expect(screen.getByText('Custom empty copy.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Find anything')).toBeInTheDocument();
  });

  it('saves a recent search after navigating to a result', async () => {
    vi.spyOn(client, 'search').mockResolvedValue([
      makeResult({ id: '1', title: 'Configuration', url: '/cfg' }),
    ]);
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderDialog({ onOpenChange });

    const input = screen.getByPlaceholderText('Search documentation…');
    await user.type(input, 'config');
    await waitFor(() => screen.getByRole('option'));
    await user.keyboard('{Enter}');

    const stored = JSON.parse(
      window.localStorage.getItem('tale.docs.recentSearches.v1') ?? '[]',
    );
    expect(stored).toHaveLength(1);
    expect(stored[0].query).toBe('config');
    expect(stored[0].url).toBe('/cfg');
  });

  it('pre-warms the index when opened', async () => {
    const loadSpy = vi.mocked(client.loadIndex);
    renderDialog();
    await waitFor(() => {
      expect(loadSpy).toHaveBeenCalled();
    });
  });

  it('does nothing visible when closed', () => {
    render(<SearchDialog locale="en" open={false} onOpenChange={() => {}} />);
    expect(
      screen.queryByPlaceholderText('Search documentation…'),
    ).not.toBeInTheDocument();
  });

  it('shows the skeleton while the first search is in flight', async () => {
    let resolve: (rows: SearchResult[]) => void = () => {};
    vi.spyOn(client, 'search').mockImplementation(
      () => new Promise<SearchResult[]>((r) => (resolve = r)),
    );
    const user = userEvent.setup();
    renderDialog();
    await user.type(
      screen.getByPlaceholderText('Search documentation…'),
      'config',
    );
    await waitFor(() => {
      expect(screen.getByTestId('search-skeleton')).toBeInTheDocument();
    });
    resolve([makeResult({ id: '1', title: 'Configuration' })]);
    await waitFor(() => {
      expect(screen.queryByTestId('search-skeleton')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Configuration')).toBeInTheDocument();
  });

  it('resets listbox scroll to top when results change but does NOT scroll mid-keystroke from hover', async () => {
    // Regression: typing a new query used to fire `scrollIntoView` on the
    // freshly-active row (index 0), jumping scroll back to top while the
    // user was scrolling. Hover-driven activeIndex changes also called
    // `scrollIntoView`. Both were wrong — only keyboard nav should scroll.
    const manyResults = Array.from({ length: 20 }, (_, i) =>
      makeResult({ id: `r${i}`, title: `Result ${i}`, url: `/r/${i}` }),
    );
    vi.spyOn(client, 'search').mockResolvedValue(manyResults);

    // jsdom doesn't lay out — fake the listbox scroll surface so we can
    // observe scrollTop changes.
    const user = userEvent.setup();
    renderDialog();
    await user.type(
      screen.getByPlaceholderText('Search documentation…'),
      'res',
    );
    await waitFor(() => screen.getByText('Result 0'));

    const listbox = screen.getByRole('listbox');
    listbox.scrollTop = 500;
    expect(listbox.scrollTop).toBe(500);

    // Hover a row — must NOT change scrollTop.
    const row5 = screen.getByText('Result 5').closest('button');
    if (row5) fireEvent.mouseEnter(row5);
    expect(listbox.scrollTop).toBe(500);

    // New query → new results → listbox scrolls to top and activeIndex resets.
    await user.type(
      screen.getByPlaceholderText('Search documentation…'),
      'ult',
    );
    await waitFor(() => {
      expect(listbox.scrollTop).toBe(0);
    });
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('navigates rows in DOM (visual) order when sections interleave by score', async () => {
    // Regression: groupBySection clusters results by section, so a
    // score-ordered list like [A1, B1, A2, B2] becomes DOM-ordered
    // [A1, A2, B1, B2]. Earlier the dialog navigated `results[i]` (score
    // order) instead of the visual order, producing wild scroll jumps as
    // ArrowDown landed on a row that was several positions away in the DOM.
    vi.spyOn(client, 'search').mockResolvedValue([
      makeResult({ id: 'a1', title: 'A1', section: 'alpha', url: '/a/1' }),
      makeResult({ id: 'b1', title: 'B1', section: 'bravo', url: '/b/1' }),
      makeResult({ id: 'a2', title: 'A2', section: 'alpha', url: '/a/2' }),
      makeResult({ id: 'b2', title: 'B2', section: 'bravo', url: '/b/2' }),
    ]);
    const user = userEvent.setup();
    renderDialog();
    await user.type(
      screen.getByPlaceholderText('Search documentation…'),
      'foo',
    );
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(4));

    // DOM should be visually grouped: A1, A2, B1, B2.
    const titles = screen
      .getAllByRole('option')
      .map((o) => o.querySelector('.min-w-0 > span')?.textContent);
    expect(titles).toEqual(['A1', 'A2', 'B1', 'B2']);

    // ArrowDown must follow that visual order, not the original score order.
    await user.keyboard('{ArrowDown}'); // expect A2 active
    let active = screen
      .getAllByRole('option')
      .findIndex((o) => o.getAttribute('aria-selected') === 'true');
    expect(active).toBe(1);
    expect(
      screen.getAllByRole('option')[active]?.querySelector('.min-w-0 > span')
        ?.textContent,
    ).toBe('A2');

    await user.keyboard('{ArrowDown}'); // expect B1 active (next visual row)
    active = screen
      .getAllByRole('option')
      .findIndex((o) => o.getAttribute('aria-selected') === 'true');
    expect(active).toBe(2);
    expect(
      screen.getAllByRole('option')[active]?.querySelector('.min-w-0 > span')
        ?.textContent,
    ).toBe('B1');
  });

  it('Enter navigates to the visually-selected row, not the score-ordered one', async () => {
    navigate.mockClear();
    vi.spyOn(client, 'search').mockResolvedValue([
      makeResult({ id: 'a1', title: 'A1', section: 'alpha', url: '/a/1' }),
      makeResult({ id: 'b1', title: 'B1', section: 'bravo', url: '/b/1' }),
      makeResult({ id: 'a2', title: 'A2', section: 'alpha', url: '/a/2' }),
    ]);
    const user = userEvent.setup();
    renderDialog();
    await user.type(
      screen.getByPlaceholderText('Search documentation…'),
      'foo',
    );
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));

    // ArrowDown twice → visually third row = B1 (alpha grouped first).
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(navigate).toHaveBeenCalledWith({ to: '/b/1' });
  });

  it('hides the skeleton once results arrive', async () => {
    vi.spyOn(client, 'search').mockResolvedValue([
      makeResult({ id: '1', title: 'Configuration' }),
    ]);
    const user = userEvent.setup();
    renderDialog();
    await user.type(
      screen.getByPlaceholderText('Search documentation…'),
      'config',
    );
    await waitFor(() => {
      expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId('search-skeleton')).not.toBeInTheDocument();
  });
});
