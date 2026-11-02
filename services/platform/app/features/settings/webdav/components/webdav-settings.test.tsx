import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

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

const ACTIVE: WebdavAppPasswordRow = {
  _id: 'active-password',
  label: 'Active workstation',
  prefix: 'abcd',
  createdAt: 1_800_000_000_000,
  lastUsedAt: null,
  revokedAt: null,
};
const RETIRED: WebdavAppPasswordRow = {
  _id: 'revoked-password',
  label: 'Retired workstation',
  prefix: 'efgh',
  createdAt: 1_800_000_000_000,
  lastUsedAt: null,
  revokedAt: 1_800_000_001_000,
};

const { revoke, listed } = vi.hoisted(() => ({
  revoke: vi.fn(),
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
  useRevokeWebdavAppPassword: () => revoke,
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('@/app/hooks/use-session-user', () => ({
  useAuth: () => ({ user: { email: 'alex@example.com' } }),
}));

describe('WebDAV app-password state from the native backend', () => {
  beforeEach(() => {
    revoke.mockReset().mockResolvedValue(null);
    listed.rows = [ACTIVE, RETIRED];
  });

  it('keeps an active null-timestamp password revocable and hides actions for a revoked password', async () => {
    render(
      <WebdavSettings
        organizationId="org-1"
        orgSlug="example"
        siteOrigin="https://example.com"
      />,
    );
    const activeRow = screen.getByRole('row', { name: /Active workstation/ });
    expect(within(activeRow).queryByText('revoked')).not.toBeInTheDocument();
    const retiredRow = screen.getByRole('row', { name: /Retired workstation/ });
    expect(within(retiredRow).getByText('revoked')).toBeInTheDocument();
    expect(
      within(retiredRow).queryByRole('button', { name: 'Revoke' }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(activeRow).getByRole('button', { name: 'Revoke' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Revoke',
      }),
    );
    await waitFor(() =>
      expect(revoke).toHaveBeenCalledExactlyOnceWith({ id: 'active-password' }),
    );
  });
});

// #3791: a confirmed revoke takes the row's Revoke button away once the list
// refreshes: the row stays, marked revoked, with no control left in it.
describe('WebDAV revoke keeps the keyboard in the list', () => {
  // A fresh element each time: React skips re-rendering an identical one.
  const page = () => (
    <WebdavSettings
      organizationId="org-1"
      orgSlug="example"
      siteOrigin="https://example.com"
    />
  );
  const LAPTOP: WebdavAppPasswordRow = {
    ...ACTIVE,
    _id: 'laptop-password',
    label: 'Finance laptop',
    createdAt: 1_700_000_000_000,
  };

  beforeEach(() => {
    revoke.mockReset().mockResolvedValue(null);
  });

  /** Revokes `label` from the keyboard; returns its Revoke button. */
  async function revokeByKeyboard(
    user: ReturnType<typeof render>['user'],
    label: string,
  ) {
    const row = screen.getByRole('row', { name: new RegExp(label) });
    const button = within(row).getByRole('button', { name: 'Revoke' });
    button.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    within(dialog).getByRole('button', { name: 'Revoke' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(button).toHaveFocus();
    });
    return button;
  }

  /** The refresh lands: `id` comes back revoked. */
  function refreshRevoked(
    rerender: ReturnType<typeof render>['rerender'],
    id: string,
  ) {
    listed.rows = listed.rows.map((row) =>
      row._id === id ? { ...row, revokedAt: 1_800_000_002_000 } : row,
    );
    rerender(page());
  }

  it("moves to the next row's Revoke when other passwords are left", async () => {
    listed.rows = [ACTIVE, LAPTOP, RETIRED];
    const { user, rerender } = render(page());

    await revokeByKeyboard(user, 'Active workstation');
    refreshRevoked(rerender, ACTIVE._id);

    const laptop = screen.getByRole('row', { name: /Finance laptop/ });
    await waitFor(() =>
      expect(
        within(laptop).getByRole('button', { name: 'Revoke' }),
      ).toHaveFocus(),
    );
  });

  // The table's own create action takes it, as in every settings list: the
  // revoked rows stay, with no control left in them.
  it("lands on the table's Generate when no row keeps a Revoke", async () => {
    listed.rows = [ACTIVE, RETIRED];
    const { user, rerender } = render(page());

    await revokeByKeyboard(user, 'Active workstation');
    refreshRevoked(rerender, ACTIVE._id);

    const generate = screen.getByRole('button', { name: 'Generate' });
    expect(generate.closest('[data-table-add-action]')).not.toBeNull();
    await waitFor(() => expect(generate).toHaveFocus());
  });

  // #3715's path stays its own case: a cancelled revoke changes nothing.
  it('returns a cancelled revoke to its Revoke button', async () => {
    listed.rows = [ACTIVE, RETIRED];
    const { user } = render(page());
    const button = within(
      screen.getByRole('row', { name: /Active workstation/ }),
    ).getByRole('button', { name: 'Revoke' });
    button.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    within(dialog).getByRole('button', { name: 'Cancel' }).focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(button).toHaveFocus();
    });
    expect(revoke).not.toHaveBeenCalled();
  });
});
