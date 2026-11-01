import { QueryClient } from '@tanstack/react-query';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { defineAbilityFor } from '@/lib/permissions/ability';

// Only owners and admins may read the connection's settings: the loader warms
// the read for them and for a caller whose role is not cached yet, and asks
// for nothing for a role the server refuses. Only the prefetch and the cached
// ability are stubbed.
const { cachedAbility, prefetchAdaptedQuery } = vi.hoisted(() => ({
  cachedAbility: vi.fn(),
  prefetchAdaptedQuery: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
}));
vi.mock('@/app/lib/loader-preload', () => ({ cachedAbility }));
vi.mock('@/app/lib/backend/prefetch', () => ({ prefetchAdaptedQuery }));
vi.mock(
  '@/app/features/settings/enterprise-sso/components/enterprise-sso-settings',
  () => ({ EnterpriseSsoSettings: () => null }),
);

type Loader = (args: {
  context: { queryClient: QueryClient };
  params: { id: string };
}) => unknown;

let loader: Loader;
const queryClient = new QueryClient();
const preload = () =>
  loader({ context: { queryClient }, params: { id: 'org-1' } });

describe('Enterprise SSO route loader', () => {
  beforeAll(async () => {
    const { Route } = await import('./enterprise-sso');
    loader = (Route as unknown as { loader: Loader }).loader;
  }, 60_000);

  beforeEach(() => {
    cachedAbility.mockReset();
    prefetchAdaptedQuery.mockReset();
  });

  it.each(['member', 'editor', 'developer'])(
    'asks for nothing for a cached %s',
    (role) => {
      cachedAbility.mockReturnValue(defineAbilityFor(role));

      expect(preload()).toBeUndefined();
      expect(prefetchAdaptedQuery).not.toHaveBeenCalled();
    },
  );

  it.each(['admin', 'owner'])('warms the read for a cached %s', (role) => {
    cachedAbility.mockReturnValue(defineAbilityFor(role));

    expect(preload()).toBeUndefined();
    expect(prefetchAdaptedQuery).toHaveBeenCalledWith(
      queryClient,
      'enterprise_sso/config/queries:get',
      { organizationId: 'org-1' },
    );
  });

  it('warms the read while the role is not cached yet, and leaves the denial to the page', () => {
    cachedAbility.mockReturnValue(null);

    expect(preload()).toBeUndefined();
    expect(prefetchAdaptedQuery).toHaveBeenCalledTimes(1);
  });
});
