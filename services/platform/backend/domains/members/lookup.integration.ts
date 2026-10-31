import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import type { RecordCheck } from '../../integration-lane-helpers.ts';
import { lookupMembers } from './service.ts';

/** The member lookup against the real `member` and `user` tables: the
 * statement narrows by id, email name and name key in Postgres, and what it
 * answers is one organization's members, oldest seat first [MEMBER-R11]. */
export async function checkMemberLookup(
  sql: Sql,
  record: RecordCheck,
): Promise<void> {
  const prefix = `itest-member-lookup-${randomUUID()}`;
  const acme = `${prefix}-acme`;
  const other = `${prefix}-other`;
  const start = Date.now();
  const people = [
    {
      key: 'ada',
      name: 'Ada Lovelace',
      email: `Ada.L-${prefix}@example.com`,
      org: acme,
    },
    // A name with a dot keeps it in both of its handles: `noah.berg`, never
    // `noahberg`.
    {
      key: 'noah',
      name: 'Noah.Berg',
      email: `nb-${prefix}@example.com`,
      org: acme,
    },
    // The Kelvin sign lowercases to `k`, in JavaScript and in the lookup.
    {
      key: 'kate',
      name: '\u212Aate Bell',
      email: `kb-${prefix}@example.com`,
      org: acme,
    },
    // Another organization's Ada answers to the same name handles.
    {
      key: 'stranger',
      name: 'Ada Lovelace',
      email: `stranger-${prefix}@example.com`,
      org: other,
    },
  ];
  const userId = (key: string) => `${prefix}-${key}`;
  await sql.begin(async (tx) => {
    for (const id of [acme, other]) {
      await tx`
        INSERT INTO "organization" (id, name, slug, "createdAt")
        VALUES (${id}, 'Member lookup fixture', ${id}, ${new Date(start)})
      `;
    }
    for (const [index, person] of people.entries()) {
      const at = new Date(start + index * 1000);
      await tx`
        INSERT INTO "user" (id, name, email, "emailVerified", "createdAt",
                            "updatedAt")
        VALUES (${userId(person.key)}, ${person.name}, ${person.email}, true,
                ${at}, ${at})
      `;
      await tx`
        INSERT INTO "member" (id, "userId", "organizationId", role, "createdAt")
        VALUES (${`${userId(person.key)}-seat`}, ${userId(person.key)},
                ${person.org}, 'member', ${at})
      `;
    }
  });

  const cases: {
    name: string;
    userIds: string[];
    handles: string[];
    expected: string[];
  }[] = [
    {
      name: 'by user id, another organization’s left out',
      userIds: [userId('noah'), userId('stranger')],
      handles: [],
      expected: [userId('noah')],
    },
    {
      name: 'by the part of the email before the @',
      userIds: [],
      handles: [`ada.l-${prefix}`],
      expected: [userId('ada')],
    },
    {
      name: 'by a name with dots or without spaces, oldest seat first',
      userIds: [],
      handles: ['kate.bell', 'adalovelace'],
      expected: [userId('ada'), userId('kate')],
    },
    {
      name: 'not by a name handle the name does not make',
      userIds: [],
      handles: ['noahberg'],
      expected: [],
    },
    {
      name: 'by a user id typed as a handle',
      userIds: [],
      handles: [userId('noah').toLowerCase()],
      expected: [userId('noah')],
    },
  ];
  for (const lookup of cases) {
    const found = await lookupMembers(sql, acme, lookup);
    const ids = found.map((entry) => entry.userId);
    const factorFree = found.every(
      (entry) => !('passkeyCount' in entry) && !('twoFactorEnabled' in entry),
    );
    record(
      `member lookup: ${lookup.name} [MEMBER-R11]`,
      JSON.stringify(ids) === JSON.stringify(lookup.expected) && factorFree,
      `found=${JSON.stringify(ids)}, expected=${JSON.stringify(lookup.expected)}, factorFree=${factorFree}`,
    );
  }
}
