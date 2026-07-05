import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

import { RuntimesSettings } from './runtimes-settings';

const mockCreateKey = vi
  .fn()
  .mockResolvedValue({ key: 'tale_generated-api-key', id: 'key-1' });

vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: [] }),
}));

vi.mock('@/app/hooks/use-format-date', () => ({
  useFormatDate: () => ({ formatRelative: () => 'just now' }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/lib/site-url-context', () => ({
  useSiteUrl: () => 'https://acme.tale.dev',
}));

vi.mock('@/app/features/settings/api-keys/hooks/use-api-keys', () => ({
  useCreateApiKey: () => ({ mutateAsync: mockCreateKey, isPending: false }),
}));

// The "Create API key" header action is a router `LinkButton`; there is no
// RouterProvider in a component test, so stub it to a plain link while keeping
// the real `Button` the generate flow uses.
vi.mock('@tale/ui/button', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/button')>()),
  LinkButton: ({ children }: { children: ReactNode }) => (
    <a href="#rest">{children}</a>
  ),
}));

describe('RuntimesSettings — generate & copy setup command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mints a labelled key and shows a command embedding the URL + key', async () => {
    const { user } = render(<RuntimesSettings organizationId="org-1" />);

    await user.click(
      screen.getByRole('button', { name: 'Generate key & copy command' }),
    );

    await waitFor(() => expect(mockCreateKey).toHaveBeenCalledTimes(1));
    // The key is labelled for daemon use so it is recognisable + revocable
    // from the REST API-keys table.
    expect(mockCreateKey).toHaveBeenCalledWith({ name: 'Daemon setup' });

    // The revealed command carries the workspace URL and the fresh key so a
    // paste on the target machine needs no further URL/key prompts.
    const expected =
      'tale daemon setup --yes --url https://acme.tale.dev --key tale_generated-api-key';
    await screen.findByText(expected, { exact: false });
    // The one-time key caveat is shown alongside it.
    expect(screen.getByText(/shown only once/i)).toBeInTheDocument();
  });
});
