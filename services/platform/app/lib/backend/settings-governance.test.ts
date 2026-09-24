// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mapLegalHoldError } from '@/app/features/settings/governance/legal-hold/legal-hold-errors';

import { runAdapted } from './adapters';
import { automationWriteAdapters } from './automations';
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
