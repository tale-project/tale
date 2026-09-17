import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const { bulkCreateContacts } = vi.hoisted(() => ({
  bulkCreateContacts: vi.fn(),
}));

vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  bulkCreateContacts,
}));
vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'u@example.test', name: 'User' },
        session: { id: 's1' },
      });
      await next();
    },
}));
vi.mock('../../auth/org.ts', () => ({
  requireOrgMember:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('orgId', 'o1');
      c.set('orgMember', { role: 'admin' } as never);
      await next();
    },
}));

import { createContactRoutes } from './routes.ts';

const app = createContactRoutes({ sql: {} as never, auth: {} as never });
const good = { email: 'valid@example.test', source: 'file_upload' };

async function upload(contacts: unknown[]) {
  return app.request('/bulk?orgId=o1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contacts }),
  });
}

describe('contact file import validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bulkCreateContacts.mockResolvedValue({ success: 1, failed: 0, errors: [] });
  });

  it.each([
    'not-an-email',
    'ui-eval-r2-data-no-at',
    '',
    'a'.repeat(65) + '@example.test',
  ])(
    'refuses an invalid imported email before writing any row: %s',
    async (email) => {
      expect((await upload([good, { ...good, email }])).status).toBe(400);
      expect(bulkCreateContacts).not.toHaveBeenCalled();
    },
  );

  it.each(['not a locale', 'en-123', 'de!'])(
    'refuses an invalid imported locale before writing any row: %s',
    async (locale) => {
      expect((await upload([good, { ...good, locale }])).status).toBe(400);
      expect(bulkCreateContacts).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, 'fr', 'pt-BR', 'zh_Hans'])(
    'preserves accepted and absent locales and normalizes email: %s',
    async (locale) => {
      expect(
        (await upload([{ ...good, email: ' Valid@Example.Test ', locale }]))
          .status,
      ).toBe(200);
      expect(bulkCreateContacts).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ organizationId: 'o1' }),
        [{ ...good, ...(locale === undefined ? {} : { locale }) }],
      );
    },
  );

  it('applies the same locale rule to a manually entered contact', async () => {
    const response = await app.request('/?orgId=o1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...good, locale: 'not a locale' }),
    });
    expect(response.status).toBe(400);
  });
});
