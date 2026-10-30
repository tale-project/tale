// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SESSION_ORGANIZATION_MESSAGE } from '@/lib/shared/constants/session-authority';

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

  it('tells a session bound to another organization apart from a non-member', async () => {
    // The member door's own refusal (`requireOrgMember`): a non-member's
    // code, but its sentence says the session, not the seat, is why.
    vi.spyOn(window, 'fetch').mockResolvedValue(
      Response.json(
        {
          error: 'ORG_FORBIDDEN',
          code: 'ORG_FORBIDDEN',
          message: SESSION_ORGANIZATION_MESSAGE,
        },
        { status: 403 },
      ),
    );
    const client = new QueryClient();
    await expect(
      client.fetchQuery(memberContextQuery('other-org')),
    ).resolves.toEqual({ status: 'session_restricted' });
    client.clear();
  });

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
