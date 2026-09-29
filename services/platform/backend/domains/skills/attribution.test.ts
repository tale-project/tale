// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import type { SkillSummaryView } from '../../core/skills/views.ts';
import {
  withOneSkillAttribution,
  withSkillAttribution,
} from './attribution.ts';

interface AuditRow {
  slug: string;
  action: string;
  actorId: string;
  etag: string | null;
}
interface MemberRow {
  id: string;
  name: string | null;
  email: string;
}

/**
 * A `sql` double answering the two reads the module makes — the newest skill
 * write per slug off the audit log, and the member directory — from canned
 * rows, applying the same filters the real queries do. It records every
 * query so a test can see what was (not) asked.
 */
function fakeSql(state: { audit: AuditRow[]; members: MemberRow[] }): Sql & {
  queries: string[];
} {
  const queries: string[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    queries.push(text);
    if (text.includes('app.audit_logs')) {
      const slugs = values.find(
        (value): value is string[] =>
          Array.isArray(value) && !value.includes('skill.updated'),
      );
      const actions = values.find(
        (value): value is string[] =>
          Array.isArray(value) && value.includes('skill.updated'),
      );
      return Promise.resolve(
        state.audit.filter(
          (row) =>
            slugs?.includes(row.slug) === true &&
            actions?.includes(row.action) === true,
        ),
      );
    }
    if (text.includes('"member"')) {
      const ids = values.find((value): value is string[] =>
        Array.isArray(value),
      );
      return Promise.resolve(
        state.members.filter((member) => ids?.includes(member.id) === true),
      );
    }
    throw new Error(`unexpected query: ${text}`);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return Object.assign(sql, { queries }) as unknown as Sql & {
    queries: string[];
  };
}

function skill(
  slug: string,
  fields: Partial<SkillSummaryView> = {},
): SkillSummaryView {
  return {
    slug,
    description: `${slug} skill`,
    visibility: 'org',
    origin: 'member',
    canEdit: false,
    etag: `"${slug}-live"`,
    updatedAt: 1,
    ...fields,
  };
}

const members: MemberRow[] = [
  { id: 'user-ada', name: 'Ada Lovelace', email: 'ada@example.com' },
  { id: 'user-grace', name: 'Grace Hopper', email: 'grace@example.com' },
  { id: 'user-nameless', name: '  ', email: 'nameless@example.com' },
];

describe('withSkillAttribution', () => {
  it('names the owner while they are a member, and nobody once they are not', async () => {
    const sql = fakeSql({ audit: [], members });
    const [ada, gone, nameless, builtin] = await withSkillAttribution(
      sql,
      'org_1',
      [
        skill('by-ada', { owner: 'user-ada' }),
        skill('by-gone', { owner: 'user-left' }),
        skill('by-nameless', { owner: 'user-nameless' }),
        skill('docx', { origin: 'builtin' }),
      ],
    );

    expect(ada?.ownerName).toBe('Ada Lovelace');
    expect(gone).not.toHaveProperty('ownerName');
    expect(gone?.owner).toBe('user-left');
    expect(nameless?.ownerName).toBe('nameless@example.com');
    expect(builtin).not.toHaveProperty('ownerName');
  });

  it('names the last editor when their edit produced the stored version', async () => {
    const sql = fakeSql({
      audit: [
        {
          slug: 'edited',
          action: 'skill.updated',
          actorId: 'user-grace',
          etag: '"edited-live"',
        },
      ],
      members,
    });
    const [edited] = await withSkillAttribution(sql, 'org_1', [
      skill('edited', { owner: 'user-ada' }),
    ]);

    expect(edited).toMatchObject({
      ownerName: 'Ada Lovelace',
      updatedBy: 'user-grace',
      updatedByName: 'Grace Hopper',
    });
  });

  it('names no editor when the file changed outside Tale since the last edit', async () => {
    const sql = fakeSql({
      audit: [
        {
          slug: 'drifted',
          action: 'skill.updated',
          actorId: 'user-grace',
          etag: '"an-older-version"',
        },
      ],
      members,
    });
    const [drifted] = await withSkillAttribution(sql, 'org_1', [
      skill('drifted', { owner: 'user-ada' }),
    ]);

    expect(drifted).not.toHaveProperty('updatedBy');
    expect(drifted).not.toHaveProperty('updatedByName');
  });

  it('names no editor when the newest write was the creation', async () => {
    const sql = fakeSql({
      audit: [
        {
          slug: 'fresh',
          action: 'skill.created',
          actorId: 'user-ada',
          etag: '"fresh-live"',
        },
      ],
      members,
    });
    const [fresh] = await withSkillAttribution(sql, 'org_1', [
      skill('fresh', { owner: 'user-ada' }),
    ]);

    expect(fresh).not.toHaveProperty('updatedBy');
  });

  it('keeps an editor who has left as an id without a name', async () => {
    const sql = fakeSql({
      audit: [
        {
          slug: 'legacy',
          action: 'skill.updated',
          actorId: 'user-left',
          etag: '"legacy-live"',
        },
      ],
      members,
    });
    const [legacy] = await withSkillAttribution(sql, 'org_1', [
      skill('legacy', { origin: 'builtin' }),
    ]);

    expect(legacy?.updatedBy).toBe('user-left');
    expect(legacy).not.toHaveProperty('updatedByName');
  });

  it('drops attribution a view already carried rather than trusting it', async () => {
    const sql = fakeSql({ audit: [], members });
    const view = await withOneSkillAttribution(
      sql,
      'org_1',
      skill('stale', {
        owner: 'user-left',
        ownerName: 'Somebody',
        updatedBy: 'user-x',
        updatedByName: 'X',
      }),
    );

    expect(view).not.toHaveProperty('ownerName');
    expect(view).not.toHaveProperty('updatedBy');
    expect(view).not.toHaveProperty('updatedByName');
  });

  it('reads nothing for an empty listing', async () => {
    const sql = fakeSql({ audit: [], members });
    expect(await withSkillAttribution(sql, 'org_1', [])).toEqual([]);
    expect(sql.queries).toEqual([]);
  });

  it('resolves every name of a listing in one directory read, scoped to the organization', async () => {
    const sql = fakeSql({ audit: [], members });
    await withSkillAttribution(sql, 'org_1', [
      skill('a', { owner: 'user-ada' }),
      skill('b', { owner: 'user-grace' }),
      skill('c', { owner: 'user-ada' }),
    ]);

    const directoryReads = sql.queries.filter((query) =>
      query.includes('"member"'),
    );
    expect(directoryReads).toHaveLength(1);
    expect(directoryReads[0]).toContain('m."organizationId" =');
  });
});
