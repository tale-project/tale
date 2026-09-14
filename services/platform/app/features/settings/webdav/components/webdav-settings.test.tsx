import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

import { WebdavSettings } from './webdav-settings';

const { revoke } = vi.hoisted(() => ({ revoke: vi.fn() }));

vi.mock('../hooks/use-webdav-app-passwords', () => ({
  useWebdavAppPasswords: () => [
    {
      _id: 'active-password',
      label: 'Active workstation',
      prefix: 'abcd',
      createdAt: 1_800_000_000_000,
      lastUsedAt: null,
      revokedAt: null,
    },
    {
      _id: 'revoked-password',
      label: 'Retired workstation',
      prefix: 'efgh',
      createdAt: 1_800_000_000_000,
      lastUsedAt: null,
      revokedAt: 1_800_000_001_000,
    },
  ],
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
