// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { knowledgeShimHandlers } from './service.ts';

/**
 * The retrievable filter as the reused search/fetch modules DISPATCH it: the
 * caller's identity travels as a top-level `userId`, and the shim has to turn
 * that into a decided caller (member row → admin or not) before the
 * conversation branch can admit an emailed attachment. The cast used to drop
 * the id, so the #3220 decision was reachable only from tests that hand-built
 * a caller — never from a chat turn.
 *
 * The decision itself is `decideRetrievable` (pure, tested); what is pinned
 * here is the PLUMBING from the wire shape to that decision.
 */

const FILTER = 'documents/internal_queries:filterRetrievableRagFileIds';
const ORG = 'org-1';
const REF = 's3:mail/bob-brief.txt';

interface Script {
  /** The member row for the asking user, keyed by user id. */
  members?: Record<string, { role: string }>;
  /** The conversation the attachment arrived on. */
  conversation?: {
    id: string;
    assigneeUserId: string | null;
    assigneeTeamId: string | null;
  };
}

/** Scripted `sql`: the member read, the (empty) document read, the unbound
 * file read, and the conversation read the filter makes. */
function fakeSql(script: Script): Sql {
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('FROM "member"')) {
      const userId = values[1];
      const member =
        typeof userId === 'string' ? script.members?.[userId] : undefined;
      return Promise.resolve(
        member
          ? [{ id: 'm-1', organizationId: ORG, userId, role: member.role }]
          : [],
      );
    }
    if (text.includes('FROM app.documents')) return Promise.resolve([]);
    if (text.includes('FROM app.file_metadata')) {
      return Promise.resolve([
        {
          storageRef: REF,
          threadId: null,
          conversationId: script.conversation?.id ?? null,
          lifecycleStatus: null,
        },
      ]);
    }
    if (text.includes('FROM app.conversations')) {
      return Promise.resolve(script.conversation ? [script.conversation] : []);
    }
    throw new Error(`unexpected statement: ${text}`);
  };
  return fn as unknown as Sql;
}

async function dispatch(
  script: Script,
  args: { userId?: string; includeConversationScoped?: boolean },
): Promise<string[]> {
  const handler = knowledgeShimHandlers(fakeSql(script))[FILTER];
  if (handler === undefined) throw new Error('filter handler missing');
  const result = await handler({
    organizationId: ORG,
    fileIds: [REF],
    access: {
      teamIds: [],
      projectIds: [],
      includeHub: true,
      includeConversationScoped: args.includeConversationScoped ?? true,
    },
    ...(args.userId !== undefined ? { userId: args.userId } : {}),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the handler answers the filter's string list
  return result as string[];
}

describe('filterRetrievableRagFileIds through the shim', () => {
  const assigned = {
    id: 'conv-1',
    assigneeUserId: 'u-assignee',
    assigneeTeamId: null,
  };

  it('admits an emailed attachment to the conversation assignee', async () => {
    const seen = await dispatch(
      { members: { 'u-assignee': { role: 'member' } }, conversation: assigned },
      { userId: 'u-assignee' },
    );
    expect(seen).toEqual([REF]);
  });

  it('denies it to another member of the same organization', async () => {
    const seen = await dispatch(
      { members: { 'u-other': { role: 'member' } }, conversation: assigned },
      { userId: 'u-other' },
    );
    expect(seen).toEqual([]);
  });

  it('admits an unassigned inbox row to an admin only', async () => {
    const triage = { id: 'conv-2', assigneeUserId: null, assigneeTeamId: null };
    const members = {
      'u-admin': { role: 'admin' },
      'u-owner': { role: 'owner' },
      'u-member': { role: 'member' },
    };
    expect(
      await dispatch({ members, conversation: triage }, { userId: 'u-admin' }),
    ).toEqual([REF]);
    expect(
      await dispatch({ members, conversation: triage }, { userId: 'u-owner' }),
    ).toEqual([REF]);
    expect(
      await dispatch({ members, conversation: triage }, { userId: 'u-member' }),
    ).toEqual([]);
  });

  it('denies it without an identity on the wire', async () => {
    // A scope with no `userId` is a surface that has not said who asks; the
    // branch is assignment privacy, so nobody is the answer.
    const seen = await dispatch(
      { members: { 'u-assignee': { role: 'member' } }, conversation: assigned },
      {},
    );
    expect(seen).toEqual([]);
  });

  it('denies it to a user with no live member row', async () => {
    expect(
      await dispatch({ conversation: assigned }, { userId: 'u-assignee' }),
    ).toEqual([]);
    expect(
      await dispatch(
        {
          members: { 'u-assignee': { role: 'disabled' } },
          conversation: assigned,
        },
        { userId: 'u-assignee' },
      ),
    ).toEqual([]);
  });

  it('never admits it to a scope that did not ask for conversation rows', async () => {
    const seen = await dispatch(
      { members: { 'u-assignee': { role: 'admin' } }, conversation: assigned },
      { userId: 'u-assignee', includeConversationScoped: false },
    );
    expect(seen).toEqual([]);
  });
});
