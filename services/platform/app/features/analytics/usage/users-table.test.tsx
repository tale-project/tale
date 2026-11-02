import { DEFAULT_LIST_PAGE_SIZE } from '@tale/ui/list-page-size';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { act, render, screen } from '@/tests/utils/render';

import { UsersTable, type UserRow } from './users-table';

function row(
  userId: string,
  displayName: string,
  apiKey?: UserRow['apiKey'],
): UserRow {
  return {
    userId,
    displayName,
    teamId: null,
    inputTokens: 10,
    outputTokens: 5,
    tokens: 15,
    costCents: 0,
    requests: 1,
    ...(apiKey && { apiKey }),
  };
}

// Every user and API key of the period, cost first as the server sends them.
// Past the first window come the rows a search has to reach: an API key of
// team Sales, the bucket runs a trigger started book under, and Ada.
const ROWS: UserRow[] = [
  ...Array.from({ length: DEFAULT_LIST_PAGE_SIZE }, (_, i) =>
    row(`user-${i}`, `Person ${i}`),
  ),
  row('key-1', 'Nightly sync', {
    kind: 'team',
    teamName: 'Sales',
    projectName: null,
  }),
  row('user-21', 'Person 21'),
  row('__automation__', '__automation__'),
  row('user-23', 'Person 23'),
  row('user-24', 'Ada Lovelace'),
].map((usage, position) =>
  Object.assign(usage, { costCents: (100 - position) * 10 }),
);
const MANY = ROWS.length;

/** What each row's User cell names, in the server's order. */
const NAMES = ROWS.map(({ userId, displayName }) =>
  userId === '__automation__' ? 'Automations (triggers)' : displayName,
);
const FIRST_WINDOW = NAMES.slice(0, DEFAULT_LIST_PAGE_SIZE);

/** The names the User column shows, top to bottom. */
function shownNames(): string[] {
  return screen
    .getAllByText(
      /^(Person \d+|Nightly sync|Automations \(triggers\)|Ada Lovelace)$/,
    )
    .map((name) => name.textContent ?? '');
}

/** The sentinels the table watches, so a test can scroll one into view. */
const watched: { callback: IntersectionObserverCallback; target: Element }[] =
  [];

class RecordingObserver {
  readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    watched.push({ callback: this.callback, target });
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function scrollToEnd() {
  const sentinel = watched.at(-1);
  expect(sentinel).toBeDefined();
  act(() => {
    sentinel?.callback(
      [
        {
          isIntersecting: true,
          target: sentinel.target,
        } as unknown as IntersectionObserverEntry,
      ],
      {} as IntersectionObserver,
    );
  });
}

afterEach(() => {
  watched.length = 0;
  vi.unstubAllGlobals();
});

// The usage page's users table follows the settings list pattern (#5163): a
// window of rows that grows as the reader scrolls, a search in its own
// toolbar, and the shared count footer. The server sends every row, so every
// one of them stays reachable.
describe('UsersTable', () => {
  it('shows one window of rows in the server order, over the count footer', () => {
    render(<UsersTable rows={ROWS} isLoading={false} />);

    expect(shownNames()).toEqual(FIRST_WINDOW);
    expect(
      screen.getByText(
        `Showing ${DEFAULT_LIST_PAGE_SIZE} of ${MANY} users and API keys`,
      ),
    ).toBeInTheDocument();
  });

  it('loads the rest as the reader scrolls, still in the server order', () => {
    vi.stubGlobal('IntersectionObserver', RecordingObserver);
    render(<UsersTable rows={ROWS} isLoading={false} />);

    scrollToEnd();

    expect(shownNames()).toEqual(NAMES);
    expect(
      screen.getByText(`Showing all ${MANY} users and API keys`),
    ).toBeInTheDocument();
  });

  it.each([
    ['a person by name', 'ada', 'Ada Lovelace'],
    ['an API key by its team', 'sales', 'Nightly sync'],
    [
      'the trigger-started runs by their row',
      'automations',
      'Automations (triggers)',
    ],
  ])(
    'finds %s past the first window, and clearing the search restores it',
    async (_, query, name) => {
      const { user } = render(<UsersTable rows={ROWS} isLoading={false} />);
      const search = screen.getByPlaceholderText('Search users and API keys');

      await user.type(search, query);

      expect(shownNames()).toEqual([name]);
      expect(
        screen.getByText(`Showing 1 of ${MANY} users and API keys`),
      ).toBeInTheDocument();

      await user.clear(search);

      expect(shownNames()).toEqual(FIRST_WINDOW);
      expect(
        screen.getByText(
          `Showing ${DEFAULT_LIST_PAGE_SIZE} of ${MANY} users and API keys`,
        ),
      ).toBeInTheDocument();
    },
  );

  it('matches what the User cell shows, not the ids behind it', async () => {
    const { user } = render(<UsersTable rows={ROWS} isLoading={false} />);

    await user.type(
      screen.getByPlaceholderText('Search users and API keys'),
      '__automation__',
    );

    expect(screen.queryByText('Automations (triggers)')).toBeNull();
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('keeps the window through a refetch, and starts it over for another read', () => {
    vi.stubGlobal('IntersectionObserver', RecordingObserver);
    const { rerender } = render(
      <UsersTable rows={ROWS} isLoading={false} windowKey="30" />,
    );
    scrollToEnd();
    expect(shownNames()).toEqual(NAMES);

    rerender(<UsersTable rows={[...ROWS]} isLoading={false} windowKey="30" />);
    expect(shownNames()).toEqual(NAMES);

    rerender(<UsersTable rows={ROWS} isLoading={false} windowKey="7" />);
    expect(shownNames()).toEqual(FIRST_WINDOW);
  });

  // DataTable's root holds its toolbar and the bordered frame;
  // `overflow-x-auto` is the scrollport of the non-sticky layout a scrolling
  // page needs (#2381, #2436). A sticky table has none, and fails here.
  it('keeps the search in the table toolbar, above a frame the page scrolls', () => {
    render(<UsersTable rows={ROWS} isLoading={false} />);
    const table = screen.getByRole('table');
    const root =
      table.closest('.overflow-x-auto')?.parentElement?.parentElement;
    const search = screen.getByPlaceholderText('Search users and API keys');

    expect(root).toContainElement(search);
    expect(table).not.toContainElement(search);
    expect(
      table.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  it('keeps the empty state and the note for a period without usage', () => {
    render(<UsersTable rows={[]} isLoading={false} />);

    expect(screen.getByText('No usage yet')).toBeInTheDocument();
    expect(screen.getByText(/^Each row is the member/)).toBeInTheDocument();
    expect(screen.queryByText(/users and API keys$/)).toBeNull();
  });

  it('passes an axe audit', async () => {
    const { container } = render(<UsersTable rows={ROWS} isLoading={false} />);
    await checkAccessibility(container);
  });
});
