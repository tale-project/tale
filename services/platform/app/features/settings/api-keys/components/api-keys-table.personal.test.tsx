import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import type { ApiKey } from '../types';
import { ApiKeysTable } from './api-keys-table';

// The table with its real columns: how another member's own key reads in an
// Owner's or Admin's view of every key that works here.
vi.mock('../hooks/use-api-keys', () => ({
  useRevokeApiKey: () => ({ mutateAsync: vi.fn() }),
}));
// The dialog has suites of its own, and stays closed here.
vi.mock('./api-key-create-dialog', () => ({
  ApiKeyCreateDialog: () => null,
}));

const OWN: ApiKey = {
  id: 'key-own',
  name: 'CI deploy key',
  start: 'tale_abc',
  prefix: 'tale_',
  suffix: 'wxyz',
  enabled: true,
  expiresAt: null,
  createdAt: Date.UTC(2026, 9, 1),
  lastRequest: null,
  owner: { kind: 'user' },
  role: null,
  createdBy: null,
  canRevoke: true,
};

const MIAS_LAPTOP: ApiKey = {
  ...OWN,
  id: 'key-mia',
  name: 'Laptop',
  start: 'tale_mia',
  suffix: 'lmno',
  owner: {
    kind: 'personal',
    userId: 'mia',
    name: 'Mia Keller',
    email: 'mia@example.test',
  },
  canRevoke: false,
};

function renderAllKeys() {
  return render(
    <ApiKeysTable
      apiKeys={[OWN, MIAS_LAPTOP]}
      organizationId="org-1"
      viewerUserId="ada"
      scope="all"
    />,
  );
}

describe('ApiKeysTable with every key that works here [APIKEY-R8]', () => {
  it('marks a member’s own key, names its holder, and offers nothing to end it', () => {
    renderAllKeys();
    const mias = screen.getByRole('row', { name: /Laptop/ });
    expect(within(mias).getByText('Personal key')).toBeInTheDocument();
    expect(within(mias).getByText('Mia Keller')).toBeInTheDocument();
    expect(within(mias).getByText('mia@example.test')).toBeInTheDocument();
    // Its last use may have been in another organization.
    expect(within(mias).getByText('Not available')).toBeInTheDocument();
    expect(within(mias).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(mias).queryByRole('button')).not.toBeInTheDocument();

    const own = screen.getByRole('row', { name: /CI deploy key/ });
    expect(within(own).queryByText('Personal key')).not.toBeInTheDocument();
    expect(within(own).getByText('Never used')).toBeInTheDocument();
    expect(within(own).getByRole('checkbox')).toBeInTheDocument();
    expect(within(own).getByRole('button')).toBeInTheDocument();
  });

  it('passes axe audit with a member’s own key listed', async () => {
    const { container } = renderAllKeys();
    await checkAccessibility(container);
  });
});
