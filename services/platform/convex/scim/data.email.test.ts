import { describe, expect, it, vi } from 'vitest';

import type { BetterAuthUser } from '../members/types';
import { findUserByEmail, type ScimReadCtx } from './data';

const LOWERCASE_USER: BetterAuthUser = {
  _id: 'user_lowercase',
  email: 'a.falco.stief@m365test4gematik.onmicrosoft.com',
  name: 'Falco Test-Tenant',
  emailVerified: false,
  createdAt: 1,
  updatedAt: 1,
};

describe('findUserByEmail case normalization', () => {
  it('finds an existing lowercase user when queried with mixed-case email', async () => {
    const queries: Array<{
      model: string;
      where: { field: string; value: string }[];
    }> = [];

    const ctx = {
      runQuery: vi.fn(
        async (
          _ref: unknown,
          args: {
            model: string;
            where: { field: string; value: string; operator: string }[];
          },
        ) => {
          queries.push({ model: args.model, where: args.where });
          const emailWhere = args.where.find((w) => w.field === 'email');
          if (
            args.model === 'user' &&
            emailWhere?.value === LOWERCASE_USER.email
          ) {
            return { page: [LOWERCASE_USER], isDone: true };
          }
          return { page: [], isDone: true };
        },
      ),
    };

    const found = await findUserByEmail(
      ctx as unknown as ScimReadCtx,
      'A.Falco.Stief@M365Test4gematik.onmicrosoft.com',
    );

    expect(found?._id).toBe('user_lowercase');
    const emailQuery = queries.find(
      (q) =>
        q.model === 'user' &&
        q.where.some(
          (w) => w.field === 'email' && w.value === LOWERCASE_USER.email,
        ),
    );
    expect(emailQuery).toBeDefined();
  });

  it('does not match when only a mixed-case row exists (pre-migration legacy)', async () => {
    const ctx = {
      runQuery: vi.fn(
        async (
          _ref: unknown,
          args: {
            model: string;
            where: { field: string; value: string; operator: string }[];
          },
        ) => {
          const emailWhere = args.where.find((w) => w.field === 'email');
          if (
            args.model === 'user' &&
            emailWhere?.value === 'user@example.com'
          ) {
            return { page: [], isDone: true };
          }
          return { page: [], isDone: true };
        },
      ),
    };

    const found = await findUserByEmail(
      ctx as unknown as ScimReadCtx,
      'User@Example.COM',
    );
    expect(found).toBeUndefined();
  });
});
