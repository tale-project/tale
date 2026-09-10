// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { backendKey } from './query-keys';
import { settingsReadAdapters, settingsWriteAdapters } from './settings';

beforeEach(() => {
  window.__ENV__ = { BASE_PATH: '' };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.__ENV__;
});

describe('sandbox capacity adapter', () => {
  it('requests an organization-scoped infrastructure snapshot and preserves unknown state', async () => {
    const response = { status: 'unavailable', reason: 'unreachable' };
    const fetch = vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const adapter = settingsReadAdapters[
      'sandbox/session_queries_public:getSandboxCapacity'
    ]?.({ organizationId: 'org-a' }, { organizationId: 'org-b' });
    expect(adapter?.queryKey).toEqual(
      backendKey('org-a', 'sandbox_session', 'capacity'),
    );
    expect(adapter?.refetchInterval).toBe(15_000);
    await expect(adapter?.queryFn()).resolves.toEqual(response);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      '/api/app/sandbox/capacity?orgId=org-a',
    );
  });
});

describe('sandbox quota cache refresh', () => {
  it('invalidates this organization quota usage immediately after a limits save', () => {
    const client = new QueryClient();
    const quotaA = backendKey('org-a', 'sandbox_session', 'quota-usage');
    const quotaB = backendKey('org-b', 'sandbox_session', 'quota-usage');
    const capacity = backendKey('org-a', 'sandbox_session', 'capacity');
    client.setQueryData(quotaA, [{ used: 1, cap: 2 }]);
    client.setQueryData(quotaB, [{ used: 2, cap: 2 }]);
    client.setQueryData(capacity, { status: 'available' });

    settingsWriteAdapters[
      'governance/file_actions:saveGovernancePolicy'
    ]?.invalidate?.(
      client,
      { organizationId: 'org-a', policyType: 'sandbox_quota' },
      {},
    );

    expect(client.getQueryState(quotaA)?.isInvalidated).toBe(true);
    expect(client.getQueryState(quotaB)?.isInvalidated).toBe(false);
    expect(client.getQueryState(capacity)?.isInvalidated).toBe(false);
    client.clear();
  });

  it('leaves sandbox usage alone when saving a different policy', () => {
    const client = new QueryClient();
    const quota = backendKey('org-a', 'sandbox_session', 'quota-usage');
    client.setQueryData(quota, [{ used: 1, cap: 2 }]);
    settingsWriteAdapters[
      'governance/file_actions:saveGovernancePolicy'
    ]?.invalidate?.(
      client,
      { organizationId: 'org-a', policyType: 'budgets' },
      {},
    );
    expect(client.getQueryState(quota)?.isInvalidated).toBe(false);
    client.clear();
  });
});
