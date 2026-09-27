import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { render, screen, waitFor, within } from '@/tests/utils/render';

import '@/app/globals.css';

import type { ApiKey } from '../types';
import { ApiKeysTable } from './api-keys-table';

vi.mock('../hooks/use-api-keys', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/use-api-keys')>()),
  useRevokeApiKey: () => ({ mutateAsync: vi.fn() }),
  useCreateApiKey: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ key: 'tale_test-key' }),
    isPending: false,
  }),
}));

afterEach(cleanup);

it('returns focus to the create action after the first key moves it to the toolbar', async () => {
  const { user, rerender } = render(
    <ApiKeysTable apiKeys={[]} organizationId="org1" />,
  );
  const opener = screen.getByRole('button', { name: 'Create API key' });
  await user.click(opener);
  const dialog = await screen.findByRole('dialog');
  await user.type(
    within(dialog).getByRole('textbox', { name: /Key name/ }),
    'CI key',
  );
  await user.click(within(dialog).getByRole('button', { name: 'Create key' }));
  await screen.findByText('tale_test-key');

  const key: ApiKey = {
    id: 'key1',
    name: 'CI key',
    start: 'tale_',
    prefix: 'tale_',
    suffix: 'test',
    userId: 'user1',
    enabled: true,
    expiresAt: null,
    createdAt: new Date(),
    lastRequest: null,
  };
  rerender(<ApiKeysTable apiKeys={[key]} organizationId="org1" />);
  expect(opener.isConnected).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Create API key' }),
    ).toHaveFocus(),
  );
});
