import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import type { RecordCheck } from '../../integration-lane-helpers.ts';
import {
  type MemberSearchPosition,
  type MemberSearchScope,
  searchMembers,
} from './service.ts';

/** The member search against the real `member`, `user` and `teamMember`
 * tables: what the statement matches, whom each access keeps, and that the
 * pages of one search, read to the end, hold every member once, in the
 * order they joined, members who joined in the same millisecond included
 * [MEMBER-R12]. */
export async function checkMemberSearch(
  sql: Sql,
  record: RecordCheck,
): Promise<void> {
  const prefix = `itest-member-search-${randomUUID()}`;
  const acme = `${prefix}-acme`;
  const other = `${prefix}-other`;
  const design = `${prefix}-design`;
  const foreign = `${prefix}-foreign`;
  const start = Date.now();
  const people = [
    { key: 'ada', name: 'Ada Lovelace', role: 'admin', team: false },
    { key: 'noah', name: 'Noah Berg', role: 'member', team: true },
    // Two spaces in a name match as one, and as a dot, and as none.
    { key: 'stein', name: 'Noah  Stein', role: 'editor', team: false },
    { key: 'dora', name: 'Dora Quinn', role: 'disabled', team: true },
    // `%` and `_` match only themselves: `50%` must not find `Room 500`.
    { key: 'percy', name: 'Percy 50% Off', role: 'developer', team: true },
    { key: 'room', name: 'Room 500', role: 'member', team: false },
    // The twins join in the same millisecond.
    { key: 'twin-a', name: 'Twin Alpha', role: 'member', team: false },
    { key: 'twin-b', name: 'Twin Beta', role: 'member', team: false },
  ];
  const joinedAt = (index: number) =>
    new Date(start + Math.min(index, 6) * 1000);
  const userId = (key: string) => `${prefix}-${key}`;
  const email = (key: string) => `${key}-${prefix}@example.com`;
  await sql.begin(async (tx) => {
    for (const id of [acme, other]) {
      await tx`
        INSERT INTO "organization" (id, name, slug, "createdAt")
        VALUES (${id}, 'Member search fixture', ${id}, ${new Date(start)})
      `;
    }
    await tx`
      INSERT INTO "team" ("id", "name", "organizationId", "createdAt")
      VALUES (${design}, 'Design', ${acme}, ${new Date(start)})
    `;
    // A team of the other organization, which an Acme member is on too.
    await tx`
      INSERT INTO "team" ("id", "name", "organizationId", "createdAt")
      VALUES (${foreign}, 'Design', ${other}, ${new Date(start)})
    `;
    for (const [index, person] of people.entries()) {
      const at = joinedAt(index);
      await tx`
        INSERT INTO "user" (id, name, email, "emailVerified", "createdAt",
                            "updatedAt")
        VALUES (${userId(person.key)}, ${person.name}, ${email(person.key)},
                true, ${at}, ${at})
      `;
      await tx`
        INSERT INTO "member" (id, "userId", "organizationId", role, "createdAt")
        VALUES (${`${userId(person.key)}-seat`}, ${userId(person.key)},
                ${acme}, ${person.role}, ${at})
      `;
      if (person.team) {
        await tx`
          INSERT INTO "teamMember" ("id", "teamId", "userId", "createdAt")
          VALUES (${`${userId(person.key)}-design`}, ${design},
                  ${userId(person.key)}, ${at})
        `;
      }
    }
    await tx`
      INSERT INTO "teamMember" ("id", "teamId", "userId", "createdAt")
      VALUES (${`${userId('room')}-foreign`}, ${foreign}, ${userId('room')},
              ${new Date(start)})
    `;
    // Another organization's Noah Berg, a member of its own.
    await tx`
      INSERT INTO "user" (id, name, email, "emailVerified", "createdAt",
                          "updatedAt")
      VALUES (${userId('stranger')}, 'Noah Berg', ${email('stranger')}, true,
              ${new Date(start)}, ${new Date(start)})
    `;
    await tx`
      INSERT INTO "member" (id, "userId", "organizationId", role, "createdAt")
      VALUES (${`${userId('stranger')}-seat`}, ${userId('stranger')}, ${other},
              'member', ${new Date(start)})
    `;
  });

  const everyone = people.map((person) => userId(person.key));
  const cases: {
    name: string;
    query: string;
    scope: MemberSearchScope;
    expected: string[];
  }[] = [
    {
      name: 'by a part of the name, whatever the case, another organization’s left out',
      query: 'NOAH',
      scope: {},
      expected: [userId('noah'), userId('stein')],
    },
    {
      name: 'by a name with its spaces as one, as a dot and as none',
      query: 'noah stein',
      scope: {},
      expected: [userId('stein')],
    },
    {
      name: 'by a name handle with dots',
      query: 'noah.stein',
      scope: {},
      expected: [userId('stein')],
    },
    {
      name: 'by a name handle without spaces',
      query: 'noahberg',
      scope: {},
      expected: [userId('noah')],
    },
    {
      name: 'by a part of the email',
      query: `noah-${prefix}@`,
      scope: {},
      expected: [userId('noah')],
    },
    {
      name: 'by what was typed with its spaces as hyphens',
      query: 'noah itest member search',
      scope: {},
      expected: [userId('noah')],
    },
    {
      name: 'by what LIKE would read as wildcards, matched as themselves',
      query: '50%',
      scope: {},
      expected: [userId('percy')],
    },
    {
      name: 'nobody for an underscore no name or email holds',
      query: '_',
      scope: {},
      expected: [],
    },
    {
      name: 'everyone, the disabled too, for no text and no access',
      query: '',
      scope: {},
      expected: everyone,
    },
    {
      name: 'readers leave the disabled out',
      query: '',
      scope: { access: 'read' },
      expected: everyone.filter((id) => id !== userId('dora')),
    },
    {
      name: 'readers of a project are its admins and its teams’ members',
      query: '',
      scope: { access: 'read', projectTeamIds: [design] },
      expected: [userId('ada'), userId('noah'), userId('percy')],
    },
    {
      name: 'readers of a project keep no one for a team of another organization',
      query: '',
      scope: { access: 'read', projectTeamIds: [design, foreign] },
      expected: [userId('ada'), userId('noah'), userId('percy')],
    },
    {
      name: 'readers of a project without teams are everyone not disabled',
      query: '',
      scope: { access: 'read', projectTeamIds: [] },
      expected: everyone.filter((id) => id !== userId('dora')),
    },
    {
      name: 'editors of a project are its readers from Editor up',
      query: '',
      scope: { access: 'edit', projectTeamIds: [design] },
      expected: [userId('ada'), userId('percy')],
    },
    {
      name: 'editors of the organization are its members from Editor up',
      query: '',
      scope: { access: 'edit' },
      expected: [userId('ada'), userId('stein'), userId('percy')],
    },
  ];
  for (const search of cases) {
    const page = await searchMembers(sql, acme, {
      query: search.query,
      ...search.scope,
      limit: 100,
      cursor: null,
    });
    const ids = page.members.map((entry) => entry.userId);
    const factorFree = page.members.every(
      (entry) => !('passkeyCount' in entry) && !('twoFactorEnabled' in entry),
    );
    record(
      `member search: ${search.name} [MEMBER-R12]`,
      JSON.stringify(ids) === JSON.stringify(search.expected) &&
        page.next === null &&
        factorFree,
      `found=${JSON.stringify(ids)}, expected=${JSON.stringify(search.expected)}, next=${JSON.stringify(page.next)}, factorFree=${factorFree}`,
    );
  }

  // One member a page: every boundary falls somewhere, the one between the
  // twins included.
  const paged: string[] = [];
  let cursor: MemberSearchPosition | null = null;
  for (let pages = 0; pages <= people.length; pages += 1) {
    const page: Awaited<ReturnType<typeof searchMembers>> = await searchMembers(
      sql,
      acme,
      { query: '', limit: 1, cursor },
    );
    paged.push(...page.members.map((entry) => entry.userId));
    cursor = page.next;
    if (cursor === null) break;
  }
  record(
    'member search: the pages of one search hold every member once, in the order they joined [MEMBER-R12]',
    JSON.stringify(paged) === JSON.stringify(everyone) && cursor === null,
    `paged=${JSON.stringify(paged)}, expected=${JSON.stringify(everyone)}`,
  );
}
