import { DEFAULT_LIST_PAGE_SIZE } from '@tale/ui/list-page-size';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, within } from '@/tests/utils/render';

import { WebdavSettings } from './webdav-settings';

/** The listing's fields the page reads. */
interface WebdavAppPasswordRow {
  _id: string;
  label: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

const { listed } = vi.hoisted(() => ({
  listed: { rows: [] as WebdavAppPasswordRow[] },
}));

// A list read that answered `listed.rows`; a failed one has its own suite
// (`webdav-settings.read-failure.test.tsx`).
vi.mock('../hooks/use-webdav-app-passwords', () => ({
  useWebdavAppPasswords: () => ({
    rows: listed.rows,
    error: null,
    unavailable: false,
    stale: false,
    retrying: false,
    failureCount: 0,
    retry: () => {},
  }),
  useCreateWebdavAppPassword: () => vi.fn(),
  useRevokeWebdavAppPassword: () => vi.fn(),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => ({ user: { email: 'alex@example.com' } }),
}));

/** More rows than one display window holds. */
const MANY = DEFAULT_LIST_PAGE_SIZE + 5;
const AT = 1_750_000_000_000;

/** Workstation `i`'s password, generated `i` minutes after the first. */
function password(i: number): WebdavAppPasswordRow {
  return {
    _id: `password-${i}`,
    label: `Workstation ${i}`,
    prefix: `pw${String(i).padStart(2, '0')}`,
    createdAt: AT + i * 60_000,
    lastUsedAt: null,
    revokedAt: null,
  };
}

/** `count` passwords, oldest first, as no order the read promises. */
function passwords(count: number) {
  return Array.from({ length: count }, (_, i) => password(i));
}

const page = () => (
  <WebdavSettings
    organizationId="org-1"
    orgSlug="example"
    siteOrigin="https://example.com"
  />
);

/** The app-passwords table, named by its caption. */
const passwordsTable = () =>
  screen.getByRole('table', { name: 'App-passwords' });

/** The labels of the rows on screen, top to bottom. */
const shownLabels = () =>
  screen.getAllByText(/^Workstation \d+$/).map((label) => label.textContent);

/**
 * DataTable's own root: it holds the table's toolbar and the bordered frame
 * whose scrollport holds the table. `overflow-x-auto` is the scrollport of the
 * non-sticky layout a scrolling settings page needs (#2381, #2436); a sticky
 * table has none, and fails here.
 */
function tableRoot(table: HTMLElement): HTMLElement {
  const root = table.closest('.overflow-x-auto')?.parentElement?.parentElement;
  if (!root) throw new Error('No non-sticky DataTable frame around the table');
  return root;
}

/**
 * Each control sits in the table's own toolbar: inside the DataTable, above
 * the table and never in it. A button in the section's header fails the
 * first check.
 */
function expectInToolbar(table: HTMLElement, controls: HTMLElement[]) {
  const root = tableRoot(table);
  for (const control of controls) {
    expect(root).toContainElement(control);
    expect(table).not.toContainElement(control);
    expect(
      table.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  }
}

/** The one Generate button, which is DataTable's `addAction`. */
function generateButton(): HTMLElement {
  const buttons = screen.getAllByRole('button', { name: 'Generate' });
  expect(buttons).toHaveLength(1);
  const button = buttons[0] as HTMLElement;
  expect(button.closest('[data-table-add-action]')).not.toBeNull();
  return button;
}

beforeEach(() => {
  listed.rows = [];
});

describe('The WebDAV app-passwords table follows the settings list pattern', () => {
  it('shows one window of the newest app-passwords and closes on the count footer', () => {
    listed.rows = passwords(MANY);
    render(page());

    // Newest first, so the window holds the passwords generated last.
    expect(shownLabels()).toEqual(
      Array.from(
        { length: DEFAULT_LIST_PAGE_SIZE },
        (_, i) => `Workstation ${MANY - 1 - i}`,
      ),
    );
    expect(
      screen.getByText(
        `Showing ${DEFAULT_LIST_PAGE_SIZE} of ${MANY} app-passwords`,
      ),
    ).toBeInTheDocument();
  });

  it.each([
    [1, 'Showing all 1 app-password'],
    [3, 'Showing all 3 app-passwords'],
  ])('names a list of %i whole', (count, footer) => {
    listed.rows = passwords(count);
    render(page());

    expect(shownLabels()).toHaveLength(count);
    expect(screen.getByText(footer)).toBeInTheDocument();
  });

  it('counts a revoked app-password and keeps it listed', () => {
    listed.rows = [password(0), { ...password(1), revokedAt: AT + 120_000 }];
    render(page());

    const revoked = screen.getByRole('row', { name: /Workstation 1/ });
    expect(within(revoked).getByText('revoked')).toBeInTheDocument();
    expect(screen.getByText('Showing all 2 app-passwords')).toBeInTheDocument();
  });

  it.each([
    ['with app-passwords', 2],
    ['when empty', 0],
  ])('keeps search and Generate in the table toolbar %s', async (_, count) => {
    listed.rows = passwords(count);
    const { user } = render(page());

    const generate = generateButton();
    expectInToolbar(passwordsTable(), [
      screen.getByPlaceholderText('Search app-passwords'),
      generate,
    ]);
    expect(
      screen.queryByRole('dialog', { name: 'Generate a new app-password' }),
    ).toBeNull();

    await user.click(generate);

    expect(
      await screen.findByRole('dialog', {
        name: 'Generate a new app-password',
      }),
    ).toBeInTheDocument();
  });

  it.each([
    ['its label', 'finance'],
    ['its prefix', 'zz99'],
  ])('finds an app-password by %s', async (_, searchText) => {
    listed.rows = [
      ...passwords(MANY),
      { ...password(MANY), label: 'Finance laptop', prefix: 'zz99' },
    ];
    const { user } = render(page());

    await user.type(
      screen.getByPlaceholderText('Search app-passwords'),
      searchText,
    );

    expect(
      await screen.findByText(`Showing 1 of ${MANY + 1} app-passwords`),
    ).toBeInTheDocument();
    expect(screen.getByText('Finance laptop')).toBeInTheDocument();
    expect(screen.queryAllByText(/^Workstation \d+$/)).toHaveLength(0);
  });
});
