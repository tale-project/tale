import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CONTACT_IMPORT_ROWS_MAX } from '../../../lib/shared/schemas/common.ts';
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

  // A refused row never reaches the domain; the rest of the file does.
  it.each([
    'not-an-email',
    'ui-eval-r2-data-no-at',
    '',
    'a'.repeat(65) + '@example.test',
  ])('refuses an invalid imported email as a row error: %s', async (email) => {
    const response = await upload([good, { ...good, email }]);
    expect(response.status).toBe(200);
    expect(bulkCreateContacts).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'o1' }),
      [good],
    );
    const body = (await response.json()) as {
      failed: number;
      errors: { index: number; errorCode: string }[];
    };
    expect(body.failed).toBe(1);
    expect(body.errors).toEqual([
      expect.objectContaining({ index: 1, errorCode: 'INVALID_BODY' }),
    ]);
  });

  it.each(['not a locale', 'en-123', 'de!'])(
    'refuses an invalid imported locale as a row error: %s',
    async (locale) => {
      const response = await upload([good, { ...good, locale }]);
      expect(response.status).toBe(200);
      expect(bulkCreateContacts).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        [good],
      );
      const body = (await response.json()) as { errors: { index: number }[] };
      expect(body.errors.map((entry) => entry.index)).toEqual([1]);
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

  // Regression: the refusal carried only `invalid body`, so the import
  // dialog could not say which row or column was wrong.
  it('names the row and column of a refused import', async () => {
    const response = await upload([good, { ...good, email: 'not-an-email' }]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      errors: {
        index: number;
        error: string;
        issues: { path: string }[];
        contact: unknown;
      }[];
    };
    expect(body.errors[0]?.index).toBe(1);
    expect(body.errors[0]?.error).toMatch(/^email: /);
    expect(body.errors[0]?.issues[0]?.path).toBe('email');
    expect(body.errors[0]?.contact).toEqual({ ...good, email: 'not-an-email' });
  });

  it('still refuses a body that is not a row list', async () => {
    const response = await app.request('/bulk?orgId=o1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts: 'nope' }),
    });
    expect(response.status).toBe(400);
    expect(bulkCreateContacts).not.toHaveBeenCalled();
  });

  // The import dialog refuses a longer file before sending it, reading the
  // same constant; this pins the door's half of that agreement.
  it('takes a file of CONTACT_IMPORT_ROWS_MAX rows and refuses one more by name', async () => {
    const rows = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        ...good,
        email: `c${i}@example.test`,
      }));
    expect((await upload(rows(CONTACT_IMPORT_ROWS_MAX))).status).toBe(200);
    const refused = await upload(rows(CONTACT_IMPORT_ROWS_MAX + 1));
    expect(refused.status).toBe(400);
    const body = (await refused.json()) as {
      data: { issues: { path: string }[] };
    };
    expect(body.data.issues.map((issue) => issue.path)).toEqual(['contacts']);
    expect(bulkCreateContacts).toHaveBeenCalledTimes(1);
  });
});
