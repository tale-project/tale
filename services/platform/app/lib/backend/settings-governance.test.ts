// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mapLegalHoldError } from '@/app/features/settings/governance/legal-hold/legal-hold-errors';

import { runAdapted } from './adapters';
import { automationWriteAdapters } from './automations';
import { backendKey } from './query-keys';
import { settingsWriteAdapters } from './settings';

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
