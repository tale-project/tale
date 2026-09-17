// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { memberContextQuery } from './org';

beforeEach(() => {
  window.__ENV__ = { BASE_PATH: '' };
});
afterEach(() => {
  vi.restoreAllMocks();
  delete window.__ENV__;
});

describe('organization membership bootstrap', () => {
  it.each([
    [404, 'ORG_NOT_FOUND', 'not_found'],
    [403, 'ORG_FORBIDDEN', 'not_member'],
  ])(
    'turns HTTP %s %s into the layout terminal state',
    async (status, code, expected) => {
      vi.spyOn(window, 'fetch').mockResolvedValue(
        Response.json({ error: code }, { status }),
      );
      const client = new QueryClient();
      await expect(
        client.fetchQuery(memberContextQuery('missing-org')),
      ).resolves.toEqual({ status: expected });
      client.clear();
    },
  );

  it('does not turn a 2FA enrollment refusal into removed membership', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      Response.json(
        { error: 'two_factor_enrollment_required' },
        { status: 403 },
      ),
    );
    const client = new QueryClient();
    await expect(
      client.fetchQuery(memberContextQuery('protected-org')),
    ).rejects.toMatchObject({ code: 'two_factor_enrollment_required' });
    client.clear();
  });
});
