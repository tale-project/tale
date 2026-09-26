// @vitest-environment node

/**
 * The app-password admin doors' AUDIT trail: a WebDAV app password is a
 * credential that can write the document tree, and before this it could be
 * minted and revoked with no row in the organization's audit log. Create
 * now commits the row and its `webdav_app_password.created` row together
 * (the prefix, never the secret); revoke adds `webdav_app_password.revoked`
 * to the transaction that stamps the row and releases its locks.
 */

import type { Context } from 'hono';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const { caller, createAuditLog } = vi.hoisted(() => ({
  caller: { role: 'admin', userId: 'u1' },
  createAuditLog: vi.fn(),
}));

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('./handlers.ts', () => ({ webdavHandlers: () => ({}) }));
vi.mock('../../../lib/webdav/adapters/fetch.ts', () => ({
  fetchAdapter: vi.fn(),
}));
vi.mock('../../core/webdav/helpers.ts', () => ({
  generateAppPasswordSecret: () => 'abcd-secret-material',
  hmacHash: () => Promise.resolve('hashed'),
  requireHmacSecret: () => 'pepper',
}));
vi.mock('../../lib/rate-limit.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/rate-limit.ts')>()),
  checkOrganizationRateLimit: vi.fn(() => Promise.resolve()),
}));
vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: caller.userId, email: 'u@example.test' },
      } as never);
      await next();
    },
}));
vi.mock('../../auth/org.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/org.ts')>();
  return {
    ...actual,
    requireOrgMember:
      () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
        c.set('orgId', 'o1');
        c.set('orgMember', { role: caller.role } as never);
        await next();
      },
  };
});

import { createWebdavAdminRoutes } from './routes.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(answer: (statement: Statement) => unknown[] | undefined): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const statement = {
      text: strings.join('?').replace(/\s+/g, ' ').trim(),
      values,
    };
    statements.push(statement);
    return Promise.resolve(answer(statement) ?? []);
  };
  tag.begin = (fn: (tx: unknown) => Promise<unknown>) => fn(tag);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return { sql: tag as unknown as Sql, statements };
}

const writes = (statements: Statement[]) =>
  statements
    .filter(
      (s) =>
        s.text.startsWith('INSERT') ||
        s.text.startsWith('UPDATE') ||
        s.text.startsWith('DELETE'),
    )
    .map((s) => s.text);

function mount(sql: Sql) {
  return createWebdavAdminRoutes({ sql, auth: {} as never });
}

beforeEach(() => {
  vi.clearAllMocks();
  caller.role = 'admin';
});

describe('POST /app-passwords', () => {
  const answers = (statement: Statement) => {
    if (statement.text.startsWith('SELECT count(*)::text AS count')) {
      return [{ count: '0' }];
    }
    if (statement.text.startsWith('INSERT INTO app.webdav_app_passwords')) {
      return [{ id: 'ap-1' }];
    }
    return undefined;
  };

  it('mints the password and audits it in one transaction, recording the prefix only', async () => {
    const { sql, statements } = fakeSql(answers);
    const res = await mount(sql).request('/app-passwords', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: '  MacBook  ' }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      password: 'abcd-secret-material',
      prefix: 'abcd',
    });
    expect(writes(statements)).toEqual([
      'INSERT INTO app.webdav_app_passwords ( org_id, user_id, label, password_prefix, password_hashed, created_at_ms ) VALUES ( ?, ?, ?, ?, ?, ? ) RETURNING id',
    ]);
    expect(createAuditLog).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        organizationId: 'o1',
        actorId: 'u1',
        actorEmail: 'u@example.test',
        actorRole: 'admin',
        actorType: 'user',
        action: 'webdav_app_password.created',
        category: 'security',
        resourceType: 'webdav_app_password',
        resourceId: 'ap-1',
        resourceName: 'MacBook',
        newState: { prefix: 'abcd' },
        status: 'success',
      }),
    );
    expect(JSON.stringify(createAuditLog.mock.calls)).not.toContain(
      'abcd-secret-material',
    );
  });

  it('is a developer door', async () => {
    caller.role = 'member';
    const { sql, statements } = fakeSql(answers);
    const res = await mount(sql).request('/app-passwords', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'MacBook' }),
    });
    expect(res.status).toBe(403);
    expect(statements).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});

describe('POST /app-passwords/:id/revoke', () => {
  const row = (revokedAt: number | null) => (statement: Statement) =>
    statement.text.startsWith('SELECT id, revoked_at_ms::float8')
      ? [{ id: 'ap-1', revokedAt, label: 'MacBook', prefix: 'abcd' }]
      : undefined;

  it('stamps the row, releases its locks and audits the revocation together', async () => {
    const { sql, statements } = fakeSql(row(null));
    const res = await mount(sql).request('/app-passwords/ap-1/revoke', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(writes(statements)).toEqual([
      'UPDATE app.webdav_app_passwords SET revoked_at_ms = ? WHERE id = ? AND org_id = ?',
      'DELETE FROM app.webdav_locks WHERE app_password_id = ? AND org_id = ?',
    ]);
    expect(createAuditLog).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        organizationId: 'o1',
        actorId: 'u1',
        action: 'webdav_app_password.revoked',
        category: 'security',
        resourceType: 'webdav_app_password',
        resourceId: 'ap-1',
        resourceName: 'MacBook',
        metadata: { prefix: 'abcd' },
        status: 'success',
      }),
    );
  });

  it('answers an already revoked password without a second row', async () => {
    const { sql, statements } = fakeSql(row(1));
    const res = await mount(sql).request('/app-passwords/ap-1/revoke', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(writes(statements)).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('answers 404 for a password that is not the caller’s in this organization', async () => {
    const { sql } = fakeSql(() => undefined);
    const res = await mount(sql).request('/app-passwords/ap-9/revoke', {
      method: 'POST',
    });
    expect(res.status).toBe(404);
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});
