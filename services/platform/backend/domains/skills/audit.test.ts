// @vitest-environment node

import type { SkillFrontmatter } from '@tale/shared/schemas/skills';
import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SkillRevision } from '../../core/skills/file_actions.ts';

const { createAuditLog } = vi.hoisted(() => ({
  createAuditLog: vi.fn(async () => 'audit-1'),
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));

import { auditSkillWrite, skillChangedFields } from './audit.ts';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
const tx = {} as TransactionSql;

function revision(
  etag: string,
  meta: Partial<SkillFrontmatter> = {},
  body = '# Voice\n',
): SkillRevision {
  return {
    meta: {
      name: 'house-voice',
      description: 'How we write',
      visibility: 'org',
      owner: 'user-ada',
      extra: {},
      ...meta,
    },
    body,
    etag,
  };
}

const base = {
  organizationId: 'org_1',
  slug: 'house-voice',
  actor: { id: 'user-ada', email: 'ada@example.com', role: 'member' },
  via: 'app' as const,
};

/** The audit rows the write appended, by action. */
function rows(): Array<Record<string, unknown>> {
  return createAuditLog.mock.calls.map(
    (call) => (call as unknown as [unknown, Record<string, unknown>])[1],
  );
}

beforeEach(() => {
  createAuditLog.mockClear();
});

describe('auditSkillWrite', () => {
  it('records a new skill as created, with its audience and resulting tag', async () => {
    await auditSkillWrite(tx, {
      ...base,
      previous: null,
      current: revision('"t1"', { visibility: 'team', teams: ['b', 'a'] }),
    });

    expect(rows()).toEqual([
      expect.objectContaining({
        organizationId: 'org_1',
        actorId: 'user-ada',
        actorEmail: 'ada@example.com',
        actorRole: 'member',
        actorType: 'user',
        action: 'skill.created',
        category: 'skill',
        resourceType: 'skill',
        resourceId: 'house-voice',
        resourceName: 'house-voice',
        newState: { visibility: 'team', teams: ['a', 'b'] },
        metadata: { etag: '"t1"', via: 'app' },
        status: 'success',
      }),
    ]);
  });

  it('records an edit with the fields it changed and both tags', async () => {
    await auditSkillWrite(tx, {
      ...base,
      via: 'api',
      previous: revision('"t1"'),
      current: revision(
        '"t2"',
        { description: 'How we write now', labels: ['tone'] },
        '# Voice\n\nShorter.\n',
      ),
    });

    expect(rows()).toEqual([
      expect.objectContaining({
        action: 'skill.updated',
        changedFields: ['description', 'body', 'labels'],
        metadata: { etag: '"t2"', via: 'api', previousEtag: '"t1"' },
      }),
    ]);
  });

  it('records a sharing change beside the edit, with the audience before and after', async () => {
    await auditSkillWrite(tx, {
      ...base,
      previous: revision('"t1"', { visibility: 'team', teams: ['a'] }),
      current: revision('"t2"', { visibility: 'org' }),
    });

    expect(rows().map((row) => row.action)).toEqual([
      'skill.updated',
      'skill.sharing_changed',
    ]);
    expect(rows()[1]).toMatchObject({
      previousState: { visibility: 'team', teams: ['a'] },
      newState: { visibility: 'org', teams: [] },
      changedFields: ['visibility', 'teams'],
      metadata: { etag: '"t2"', via: 'app' },
    });
  });

  it('does not call a reordered team list a sharing change', async () => {
    await auditSkillWrite(tx, {
      ...base,
      previous: revision('"t1"', { visibility: 'team', teams: ['a', 'b'] }),
      current: revision('"t2"', { visibility: 'team', teams: ['b', 'a'] }),
    });

    expect(rows().map((row) => row.action)).toEqual(['skill.updated']);
    expect(rows()[0]).toMatchObject({ changedFields: [] });
  });

  it('records a bundle whose other files changed as updated', async () => {
    await auditSkillWrite(tx, {
      ...base,
      via: 'upload',
      previous: revision('"t1"'),
      current: revision('"t1"'),
      filesChanged: true,
    });

    expect(rows()).toEqual([
      expect.objectContaining({
        action: 'skill.updated',
        changedFields: ['files'],
      }),
    ]);
  });

  it('records nothing for a write that changed nothing', async () => {
    await auditSkillWrite(tx, {
      ...base,
      previous: revision('"t1"'),
      current: revision('"t1"'),
      filesChanged: false,
    });

    expect(createAuditLog).not.toHaveBeenCalled();
  });
});

describe('skillChangedFields', () => {
  it('ignores key order inside nested frontmatter', () => {
    expect(
      skillChangedFields(
        revision('"a"', { metadata: { a: 1, b: { c: 2, d: 3 } } }),
        revision('"b"', { metadata: { b: { d: 3, c: 2 }, a: 1 } }),
      ),
    ).toEqual([]);
  });

  it('names an adopted owner and a dropped model-invocation flag', () => {
    expect(
      skillChangedFields(
        revision('"a"', { owner: undefined, disableModelInvocation: true }),
        revision('"b"', { owner: 'user-ada' }),
      ),
    ).toEqual(['owner', 'disableModelInvocation']);
  });
});
