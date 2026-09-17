import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { approveLegalHoldRelease } from './service.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('legal-hold release anti-chaining delay', () => {
  it('returns the remaining time when a different admin approves too soon', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const statements: string[] = [];
    const tag = (parts: TemplateStringsArray) => {
      const text = parts.join('?');
      statements.push(text);
      if (text.includes('app.legal_hold_release_requests'))
        return Promise.resolve([
          {
            requestedBy: 'first-admin',
            requestedAt: 940_000,
            status: 'pending',
          },
        ]);
      return Promise.resolve([{ role: 'admin' }]);
    };
    const sql = Object.assign(tag, {
      begin: (fn: (tx: typeof tag) => unknown) => fn(tag),
    }) as unknown as Sql;
    await expect(
      approveLegalHoldRelease(sql, {
        organizationId: 'org-a',
        actorId: 'second-admin',
        requestId: 'request-a',
      }),
    ).rejects.toMatchObject({
      code: 'APPROVAL_TOO_SOON',
      status: 409,
      data: { remainingMs: 240_000 },
    });
    expect(
      statements.some((text) => text.trimStart().startsWith('UPDATE')),
    ).toBe(false);
  });
});
