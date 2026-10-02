// @vitest-environment jsdom
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mapLegalHoldError } from '@/app/features/settings/governance/legal-hold/legal-hold-errors';

import { runAdapted } from './adapters';
import { automationWriteAdapters } from './automations';
import { isPolicySettling } from './policy-write-order';
import { backendKey } from './query-keys';
import { settingsReadAdapters, settingsWriteAdapters } from './settings';

beforeEach(() => {
  window.__ENV__ = { BASE_PATH: '' };
});
afterEach(() => {
  vi.restoreAllMocks();
  delete window.__ENV__;
});

describe('governance adapters', () => {
  it.each(['chatThread', 'contact'])(
    'restores %s using the rowId supplied by Trash',
    async (resourceType) => {
      const fetch = vi
        .spyOn(window, 'fetch')
        .mockResolvedValue(Response.json({ ok: true }));
      const adapter =
        settingsWriteAdapters['governance/restore:restoreSoftDeletedRow'];
      await adapter?.run(
        { organizationId: 'org-a', resourceType, rowId: 'row-a' },
        {},
      );
      expect(fetch).toHaveBeenCalledWith(
        '/api/app/governance/trash/restore?orgId=org-a',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ resourceType, id: 'row-a' }),
        }),
      );
      const client = new QueryClient();
      const key = backendKey('org-a', 'governance_trash');
      client.setQueryData(key, []);
      adapter?.invalidate?.(client, { organizationId: 'org-a' }, {});
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      client.clear();
    },
  );

  it('carries hold approval wait details from the HTTP envelope into the UI countdown', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      Response.json(
        {
          error: 'APPROVAL_TOO_SOON',
          message: 'Wait five minutes.',
          data: { remainingMs: 241_200 },
        },
        { status: 409 },
      ),
    );
    const adapter =
      settingsWriteAdapters['governance/legal_hold:approveLegalHoldRelease'];
    expect(adapter).toBeDefined();
    const error = await runAdapted(() =>
      adapter!.run({ organizationId: 'org-a', requestId: 'release-a' }, {}),
    ).catch((err: unknown) => err);
    const translate = (key: string, options?: Record<string, unknown>) =>
      `${key}:${typeof options?.countdown === 'string' ? options.countdown : ''}`;
    expect(mapLegalHoldError(error, translate)).toMatchObject({
      remainingMs: 241_200,
      fieldError: 'legalHold.errors.approvalTooSoon:4m 02s',
    });
  });

  it('re-reads the saver’s own password rules when a password policy is saved', () => {
    // User-scoped, so no organization's hint reaches it.
    const client = new QueryClient();
    const mine = backendKey('me', 'account', 'password-policy');
    client.setQueryData(mine, {});
    const adapter =
      settingsWriteAdapters['governance/file_actions:saveGovernancePolicy'];
    adapter?.invalidate?.(
      client,
      { organizationId: 'org-a', policyType: 'upload_policy' },
      {},
    );
    expect(client.getQueryState(mine)?.isInvalidated).toBe(false);
    adapter?.invalidate?.(
      client,
      { organizationId: 'org-a', policyType: 'password_policy' },
      {},
    );
    expect(client.getQueryState(mine)?.isInvalidated).toBe(true);
    client.clear();
  });

  it('refreshes the DSAR receipt after an approval decision in this organization only', () => {
    const client = new QueryClient();
    const own = backendKey('org-a', 'gdpr_erasure', 'detail', 'request-a');
    const other = backendKey('org-b', 'gdpr_erasure', 'detail', 'request-b');
    client.setQueryData(own, {});
    client.setQueryData(other, {});
    automationWriteAdapters[
      'approvals/mutations:updateApprovalStatus'
    ]?.invalidate?.(client, {}, { organizationId: 'org-a' });
    expect(client.getQueryState(own)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    client.clear();
  });
});

describe('organization API key listing adapter', () => {
  const live = {
    id: 'key-1',
    name: 'CI',
    start: 'tale_A',
    userId: 'u-1',
    ownerName: 'Dana',
    ownerEmail: 'dana@example.test',
    createdAt: 1,
    expiresAt: null,
  };

  it.each(['revoked', 'unavailable'])(
    'keeps known identity and %s status beside the live keys for the budget picker',
    async (status) => {
      // One list for the editor: the live keys the picker offers, then the
      // keys the saved rules still name, each in the state the backend gives.
      const inactive = {
        id: 'key-2',
        name: 'Old script',
        start: 'tale_B',
        userId: 'u-2',
        ownerName: 'Ben',
        ownerEmail: 'ben@example.test',
        status,
        expiresAt: null,
      };
      const fetch = vi
        .spyOn(window, 'fetch')
        .mockResolvedValue(
          Response.json({ keys: [live], ruleKeys: [inactive] }),
        );
      const read = settingsReadAdapters['governance/api_keys:listOrgApiKeys']?.(
        { organizationId: 'org-a' },
        {},
      );
      await expect(read?.queryFn()).resolves.toEqual([
        { ...live, status: 'active' },
        { ...inactive, createdAt: null },
      ]);
      expect(fetch).toHaveBeenCalledWith(
        '/api/app/governance/api-keys?orgId=org-a',
        expect.objectContaining({ method: 'GET' }),
      );
    },
  );

  it('reads a backend that answers the live keys alone', async () => {
    // Mid-roll the previous image still serves: no `ruleKeys` on its answer.
    vi.spyOn(window, 'fetch').mockResolvedValue(
      Response.json({ keys: [live] }),
    );
    const read = settingsReadAdapters['governance/api_keys:listOrgApiKeys']?.(
      { organizationId: 'org-a' },
      {},
    );
    await expect(read?.queryFn()).resolves.toEqual([
      { ...live, status: 'active' },
    ]);
  });
});

/**
 * The key listing describes the keys the saved budget rules name, so a rule
 * change is a change to the listing too — though the listing is keyed under
 * the API-key entity, not the policy one. Saving the budgets must refresh it,
 * for this organization only.
 */
describe('budgets save → the organization’s key listing', () => {
  const listingOf = (organizationId: string) => {
    const key = settingsReadAdapters['governance/api_keys:listOrgApiKeys']?.(
      { organizationId },
      {},
    )?.queryKey;
    if (key === undefined) throw new Error('no key listing read');
    return key;
  };

  it('invalidates this organization’s key listing and leaves the rest fresh', () => {
    const client = new QueryClient();
    const own = listingOf('org-a');
    const otherOrg = listingOf('org-b');
    const otherOrgPolicy = backendKey('org-b', 'governance_policy', 'budgets');
    const ownKeyAccess = backendKey('org-a', 'api_key', 'my-access');
    for (const key of [own, otherOrg, otherOrgPolicy, ownKeyAccess]) {
      client.setQueryData(key, []);
    }
    settingsWriteAdapters[
      'governance/file_actions:saveGovernancePolicy'
    ]?.invalidate?.(
      client,
      { organizationId: 'org-a', policyType: 'budgets', config: {} },
      {},
    );
    expect(client.getQueryState(own)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherOrg)?.isInvalidated).toBe(false);
    expect(client.getQueryState(otherOrgPolicy)?.isInvalidated).toBe(false);
    expect(client.getQueryState(ownKeyAccess)?.isInvalidated).toBe(false);
    client.clear();
  });

  it('leaves the key listing alone when another policy is saved', () => {
    const client = new QueryClient();
    const own = listingOf('org-a');
    client.setQueryData(own, []);
    settingsWriteAdapters[
      'governance/file_actions:saveGovernancePolicy'
    ]?.invalidate?.(
      client,
      { organizationId: 'org-a', policyType: 'login_policy', config: {} },
      {},
    );
    expect(client.getQueryState(own)?.isInvalidated).toBe(false);
    client.clear();
  });
});

describe('competence register adapters', () => {
  it('reads the register as its record list', async () => {
    const records = [{ id: 'record-a', competence: 'tale:rest.act-as' }];
    const fetch = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(Response.json({ records }));
    const read = settingsReadAdapters[
      'governance/competences:listCompetences'
    ]?.({ organizationId: 'org-a' }, {});
    await expect(read?.queryFn()).resolves.toEqual(records);
    expect(fetch).toHaveBeenCalledWith(
      '/api/app/governance/competences?orgId=org-a',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('grants with only the fields the admin set', async () => {
    const fetch = vi
      .spyOn(window, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(
          Response.json({ recordId: 'record-a' }, { status: 201 }),
        ),
      );
    const adapter =
      settingsWriteAdapters['governance/competences:grantCompetence'];
    await expect(
      adapter?.run(
        {
          organizationId: 'org-a',
          userId: 'user-a',
          competence: 'tale:notifications.export',
          evidence: '',
        },
        {},
      ),
    ).resolves.toEqual({ recordId: 'record-a' });
    expect(fetch).toHaveBeenCalledWith(
      '/api/app/governance/competences?orgId=org-a',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          userId: 'user-a',
          competence: 'tale:notifications.export',
        }),
      }),
    );

    await adapter?.run(
      {
        organizationId: 'org-a',
        userId: 'user-a',
        competence: 'tax-reviewer',
        expiresAt: 1_800_000_000_000,
        evidence: 'Certified',
      },
      {},
    );
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/app/governance/competences?orgId=org-a',
      expect.objectContaining({
        body: JSON.stringify({
          userId: 'user-a',
          competence: 'tax-reviewer',
          expiresAt: 1_800_000_000_000,
          evidence: 'Certified',
        }),
      }),
    );
  });

  it('revokes the record by id and refreshes only this organization', async () => {
    const fetch = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(Response.json({ ok: true }));
    const adapter =
      settingsWriteAdapters['governance/competences:revokeCompetence'];
    await expect(
      adapter?.run({ organizationId: 'org-a', recordId: 'record/a' }, {}),
    ).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      '/api/app/governance/competences/record%2Fa/revoke?orgId=org-a',
      expect.objectContaining({ method: 'POST' }),
    );

    const client = new QueryClient();
    const own = backendKey('org-a', 'competence', 'list');
    const other = backendKey('org-b', 'competence', 'list');
    client.setQueryData(own, []);
    client.setQueryData(other, []);
    adapter?.invalidate?.(client, { organizationId: 'org-a' }, {});
    expect(client.getQueryState(own)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    client.clear();
  });
});

describe('governance policy writes', () => {
  const save =
    settingsWriteAdapters['governance/file_actions:saveGovernancePolicy'];
  const write = (policyType: string, config: unknown) =>
    runAdapted(() =>
      save!.run({ organizationId: 'org-a', policyType, config }, {}),
    );
  const bodies = (fetch: { mock: { calls: unknown[][] } }) =>
    fetch.mock.calls.map((call) => {
      const init: unknown = call[1];
      return init !== null &&
        typeof init === 'object' &&
        'body' in init &&
        typeof init.body === 'string'
        ? init.body
        : null;
    });
  const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

  // Each write is the whole file: sent side by side, a slow one would land
  // after a newer one and put the older file back (#4048).
  it('sends one policy’s writes one at a time, in the order they were made', async () => {
    let release = () => {};
    const fetch = vi
      .spyOn(window, 'fetch')
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(Response.json({ ok: true }));
          }),
      )
      .mockResolvedValue(Response.json({ ok: true }));

    const first = write('session_idle_timeout', {
      enabled: true,
      idleTimeoutMinutes: 30,
    });
    const second = write('session_idle_timeout', {
      enabled: true,
      idleTimeoutMinutes: 15,
    });
    await tick();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(isPolicySettling('org-a', 'session_idle_timeout')).toBe(true);

    release();
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
    expect(bodies(fetch)).toEqual([
      JSON.stringify({ config: { enabled: true, idleTimeoutMinutes: 30 } }),
      JSON.stringify({ config: { enabled: true, idleTimeoutMinutes: 15 } }),
    ]);
    await tick();
    expect(isPolicySettling('org-a', 'session_idle_timeout')).toBe(false);
  });

  it('sends the next write when the one before it fails', async () => {
    const fetch = vi
      .spyOn(window, 'fetch')
      .mockResolvedValueOnce(Response.json({ error: 'boom' }, { status: 500 }))
      .mockResolvedValue(Response.json({ ok: true }));

    const first = write('login_policy', { enabled: true });
    const second = write('login_policy', { enabled: false });
    await expect(first).rejects.toBeDefined();
    await expect(second).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not hold a write of another policy', async () => {
    const fetch = vi
      .spyOn(window, 'fetch')
      .mockImplementationOnce(() => new Promise<Response>(() => {}))
      .mockResolvedValue(Response.json({ ok: true }));

    void write('budgets', { enabled: true, rules: [] });
    await expect(
      write('feature_flags', { enabled: true, rules: [] }),
    ).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(isPolicySettling('org-a', 'budgets')).toBe(true);
    expect(isPolicySettling('org-a', 'feature_flags')).toBe(false);
  });

  it('keeps the policy settling until its read is fetched again', async () => {
    const client = new QueryClient();
    const key = backendKey('org-a', 'governance_policy', 'system_prompt');
    const releases: Array<() => void> = [];
    let reads = 0;
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: () => {
        reads += 1;
        const read = reads;
        if (read === 1) return Promise.resolve({ v: 1 });
        return new Promise<{ v: number }>((resolve) => {
          releases.push(() => resolve({ v: read }));
        });
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(client.getQueryData(key)).toEqual({ v: 1 }));

    save!.invalidate?.(
      client,
      { organizationId: 'org-a', policyType: 'system_prompt' },
      {},
    );
    expect(isPolicySettling('org-a', 'system_prompt')).toBe(true);
    await tick();
    expect(reads).toBe(2);

    // The live hint for the same write invalidates the read again: its
    // fetch replaces the one in flight, and the policy waits for it.
    void client.invalidateQueries({
      queryKey: backendKey('org-a', 'governance_policy'),
    });
    await tick();
    expect(reads).toBe(3);
    releases[0]?.();
    await tick();
    expect(isPolicySettling('org-a', 'system_prompt')).toBe(true);

    releases[1]?.();
    await vi.waitFor(() =>
      expect(isPolicySettling('org-a', 'system_prompt')).toBe(false),
    );
    expect(client.getQueryData(key)).toEqual({ v: 3 });
    unsubscribe();
    client.clear();
  });

  it('does not hold a policy whose read nobody is showing', () => {
    const client = new QueryClient();
    client.setQueryData(
      backendKey('org-a', 'governance_policy', 'data_classification_notice'),
      { config: {} },
    );
    save!.invalidate?.(
      client,
      { organizationId: 'org-a', policyType: 'data_classification_notice' },
      {},
    );
    expect(isPolicySettling('org-a', 'data_classification_notice')).toBe(false);
    client.clear();
  });
});
