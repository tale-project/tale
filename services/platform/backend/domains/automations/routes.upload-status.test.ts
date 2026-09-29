// @vitest-environment node

/**
 * The package upload's coded refusals: the team-audience ones answer with
 * the skill door's statuses, so both upload lanes agree on a 403 for a team
 * the caller is not in; every other refusal of the lane stays a 400.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../lib/shared/errors/app-error';
import type { OrgEnv } from '../../auth/org.ts';

const { uploadAutomationPg, auditIfPublishRefused } = vi.hoisted(() => ({
  uploadAutomationPg: vi.fn(),
  auditIfPublishRefused: vi.fn(),
}));

vi.mock('./upload.ts', () => ({ uploadAutomationPg }));
vi.mock('../skills/publish.ts', () => ({ auditIfPublishRefused }));

vi.mock('../../lib/org-config.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../lib/org-config.ts')>();
  return { ...actual, resolveOrgSlug: vi.fn(async () => 'acme') };
});

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'u@example.test' },
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
        c.set('orgMember', { role: 'developer' } as never);
        await next();
      },
  };
});

import { createAutomationRoutes } from './routes.ts';

async function uploadRefusedWith(code: string): Promise<Response> {
  uploadAutomationPg.mockRejectedValueOnce(
    new AppError({ code, message: `refused: ${code}` }),
  );
  return createAutomationRoutes({
    sql: {} as never,
    auth: {} as never,
  }).request('/upload?orgId=o1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ storageId: 's3:acme/staged.zip' }),
  });
}

beforeEach(() => {
  uploadAutomationPg.mockReset();
  auditIfPublishRefused.mockReset();
});

describe('POST /upload — the uploader', () => {
  it('reaches the lane with their email, for the audit rows of carried skills', async () => {
    uploadAutomationPg.mockResolvedValueOnce({
      ok: true,
      name: 'triage-flow',
      version: 1,
      warnings: [],
      skills: [],
    });
    const res = await createAutomationRoutes({
      sql: {} as never,
      auth: {} as never,
    }).request('/upload?orgId=o1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storageId: 's3:acme/staged.zip' }),
    });
    expect(res.status).toBe(200);
    expect(uploadAutomationPg.mock.calls[0]?.[1]).toEqual({
      organizationId: 'o1',
      orgSlug: 'acme',
      userId: 'u1',
      email: 'u@example.test',
      role: 'developer',
    });
  });
});

describe('POST /upload — refusal statuses', () => {
  it.each([
    ['TEAM_ACCESS_DENIED', 403],
    ['TEAM_NOT_IN_ORG', 400],
    ['SKILL_PUBLISH_FORBIDDEN', 403],
    ['STORAGE_NOT_FOUND', 400],
    ['SKILL_CONFLICT_FORBIDDEN', 400],
  ])('answers %s with %i', async (code, status) => {
    const res = await uploadRefusedWith(code);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({
      error: code,
      message: `refused: ${code}`,
    });
  });
});

describe('POST /upload — a carried organization-wide skill it may not publish', () => {
  it('hands the refusal to the denied-publish audit as the uploader, through the package door', async () => {
    const res = await uploadRefusedWith('SKILL_PUBLISH_FORBIDDEN');
    expect(res.status).toBe(403);
    expect(auditIfPublishRefused).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.any(AppError),
      {
        organizationId: 'o1',
        actor: { id: 'u1', email: 'u@example.test', role: 'developer' },
        via: 'automation_package',
      },
    );
  });
});
