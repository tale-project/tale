import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAuditLog } from '../audit_logs/service.ts';
import { approveLegalHoldRelease } from './service.ts';

vi.mock('../audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(() => Promise.resolve('audit-1')),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('legal-hold release anti-chaining delay', () => {
  it('returns the remaining time when a different admin approves too soon [HOLD-R3]', async () => {
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

describe('legal-hold release approved by its requester [HOLD-R4]', () => {
  /** A pending release `first-admin` requested at 940 000, where every
   * member read answers an admin; `statements` records what ran. */
  function releaseDb(): { sql: Sql; statements: string[] } {
    const statements: string[] = [];
    const tag = (parts: TemplateStringsArray) => {
      const text = parts.join('?');
      statements.push(text);
      if (text.includes('FROM app.legal_hold_release_requests'))
        return Promise.resolve([
          {
            requestedBy: 'first-admin',
            requestedAt: 940_000,
            status: 'pending',
          },
        ]);
      if (text.includes('FROM "member"'))
        return Promise.resolve([{ role: 'admin' }]);
      return Promise.resolve([]);
    };
    const sql = Object.assign(tag, {
      begin: (fn: (tx: typeof tag) => unknown) => fn(tag),
    }) as unknown as Sql;
    return { sql, statements };
  }
  const updated = (statements: string[]) =>
    statements.some((text) => text.trimStart().startsWith('UPDATE'));

  it('refuses the requester’s own approval while self-approval is off', async () => {
    vi.stubEnv('TALE_LEGAL_HOLD_SINGLE_ADMIN_OK', undefined);
    // Long after the wait: what refuses it is who approves, not when.
    vi.spyOn(Date, 'now').mockReturnValue(10_000_000);
    const { sql, statements } = releaseDb();

    await expect(
      approveLegalHoldRelease(sql, {
        organizationId: 'org-a',
        actorId: 'first-admin',
        requestId: 'request-a',
      }),
    ).rejects.toMatchObject({ code: 'SELF_APPROVAL_BLOCKED', status: 403 });

    expect(updated(statements)).toBe(false);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('approves it at once where the operator turned self-approval on, audited as such', async () => {
    vi.stubEnv('TALE_LEGAL_HOLD_SINGLE_ADMIN_OK', 'true');
    // One minute after the request: inside the wait another admin keeps.
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const { sql, statements } = releaseDb();

    await expect(
      approveLegalHoldRelease(sql, {
        organizationId: 'org-a',
        actorId: 'first-admin',
        requestId: 'request-a',
      }),
    ).resolves.toEqual({ effectiveAt: expect.any(Number) });

    expect(updated(statements)).toBe(true);
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: 'first-admin',
        action: 'legal_hold_release_self_approved',
      }),
    );
  });
});
