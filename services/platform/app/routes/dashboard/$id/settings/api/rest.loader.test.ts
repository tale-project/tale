import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiKeysQuery } from '@/app/features/settings/api-keys/hooks/use-api-keys';

// The keys table has no search box, so its lone Create button lives in the
// toolbar while the list loads and in the empty state once it is known to be
// empty. Painted before the keys arrived, the button jumped from one to the
// other on every cold visit to an org without keys. The route loader awaits
// the keys on the very entry the table reads, so the first paint is final.

const { cachedAbility } = vi.hoisted(() => ({
  cachedAbility: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
  Link: () => null,
}));
vi.mock('@/app/lib/loader-preload', () => ({ cachedAbility }));
vi.mock('@/app/features/settings/api-keys/components/api-keys-table', () => ({
  ApiKeysTable: () => null,
}));

type Loader = (args: {
  context: { queryClient: unknown };
  params: { id: string };
}) => Promise<void> | undefined;

let loader: Loader;

describe('API REST route loader', () => {
  // A cold import of the route module outlasts the default test timeout.
  beforeAll(async () => {
    const { Route } = await import('./rest');
    loader = (Route as unknown as { loader: Loader }).loader;
  }, 60_000);

  beforeEach(() => {
    cachedAbility.mockReset();
    cachedAbility.mockReturnValue(null);
  });

  it('awaits the API keys on the key the table reads', async () => {
    let settle: (keys: unknown[]) => void = () => {};
    const ensureQueryData = vi.fn(
      () =>
        new Promise<unknown[]>((resolve) => {
          settle = resolve;
        }),
    );

    const pending = loader({
      context: { queryClient: { ensureQueryData } },
      params: { id: 'org-1' },
    });

    expect(ensureQueryData).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: apiKeysQuery('org-1').queryKey }),
    );
    // The transition waits for the keys rather than painting without them.
    let done = false;
    void pending?.then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    settle([]);
    await pending;
    expect(done).toBe(true);
  });

  it('never fails the transition when the keys cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ensureQueryData = vi.fn(() => Promise.reject(new Error('offline')));

    await expect(
      loader({
        context: { queryClient: { ensureQueryData } },
        params: { id: 'org-1' },
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      'Failed to preload API keys',
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it('reads nothing for a caller the cached ability already denies', () => {
    cachedAbility.mockReturnValue({ cannot: () => true });
    const ensureQueryData = vi.fn();

    expect(
      loader({
        context: { queryClient: { ensureQueryData } },
        params: { id: 'org-1' },
      }),
    ).toBeUndefined();
    expect(ensureQueryData).not.toHaveBeenCalled();
  });
});
