// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { knowledgeShimHandlers } from './service.ts';

/**
 * The retrievable filter's email-message branch as the reused search/fetch
 * modules DISPATCH it: `msg:` refs used to deny outright; they are now
 * decided by the message's conversation — the same assignment privacy an
 * emailed attachment gets — and only for a door that asked for message
 * bodies. The decision is `decideMessageRetrievable` (pure, tested); pinned
 * here is the PLUMBING: which rows the filter reads for which refs, and that
 * a message ref never reaches a blob lookup.
 */

const FILTER = 'documents/internal_queries:filterRetrievableRagFileIds';
const ORG = 'org-1';
const MESSAGE_ID = '6f3c2a1e-8b7d-4e5f-9a0b-1c2d3e4f5a6b';
const MSG_REF = `msg:${MESSAGE_ID}`;
const BLOB_REF = 's3:org-1/mail/bob-cv.pdf';

interface ConversationRow {
  id: string;
  assigneeUserId: string | null;
  assigneeTeamId: string | null;
  lifecycleStatus?: string | null;
  status?: string | null;
}

interface Script {
  members?: Record<string, { role: string }>;
  /** Inbound emails by id, with the conversation each arrived on. */
  messages?: Record<string, { conversationId: string }>;
  /** Emailed attachments: blob ref → the conversation it arrived on. */
  files?: Record<string, string>;
  conversations?: ConversationRow[];
}

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(script: Script): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const conversation = (id: string) =>
    script.conversations?.find((row) => row.id === id);
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
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
      const refs = values[1] as string[];
      return Promise.resolve(
        refs.flatMap((ref) => {
          const conversationId = script.files?.[ref];
          return conversationId === undefined
            ? []
            : [
                {
                  storageRef: ref,
                  threadId: null,
                  conversationId,
                  lifecycleStatus: null,
                },
              ];
        }),
      );
    }
    if (text.includes('FROM app.conversation_messages m')) {
      const ids = values[1] as string[];
      return Promise.resolve(
        ids.flatMap((id) => {
          const message = script.messages?.[id];
          const parent =
            message === undefined
              ? undefined
              : conversation(message.conversationId);
          return message === undefined || parent === undefined
            ? []
            : [
                {
                  id,
                  conversationId: message.conversationId,
                  conversationLifecycleStatus: parent.lifecycleStatus ?? null,
                  conversationStatus: parent.status ?? 'open',
                },
              ];
        }),
      );
    }
    if (text.includes('FROM app.conversations')) {
      const ids = values[1] as string[];
      return Promise.resolve(
        (script.conversations ?? [])
          .filter((row) => ids.includes(row.id))
          .map(({ id, assigneeUserId, assigneeTeamId }) => ({
            id,
            assigneeUserId,
            assigneeTeamId,
          })),
      );
    }
    throw new Error(`unexpected statement: ${text}`);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double for the postgres.js tag
  return { sql: fn as unknown as Sql, statements };
}

async function dispatch(
  script: Script,
  args: {
    fileIds: string[];
    userId?: string;
    includeConversationMessages?: boolean;
    includeConversationScoped?: boolean;
    folder?: string;
  },
): Promise<{ admitted: string[]; statements: Statement[] }> {
  const { sql, statements } = fakeSql(script);
  const handler = knowledgeShimHandlers(sql)[FILTER];
  if (handler === undefined) throw new Error('filter handler missing');
  const result = await handler({
    organizationId: ORG,
    fileIds: args.fileIds,
    access: {
      teamIds: [],
      projectIds: [],
      includeHub: true,
      includeConversationScoped: args.includeConversationScoped ?? true,
      ...(args.includeConversationMessages !== undefined
        ? { includeConversationMessages: args.includeConversationMessages }
        : {}),
    },
    ...(args.folder !== undefined ? { folder: args.folder } : {}),
    ...(args.userId !== undefined ? { userId: args.userId } : {}),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the handler answers the filter's string list
  return { admitted: result as string[], statements };
}

const TRIAGE: ConversationRow = {
  id: 'conv-triage',
  assigneeUserId: null,
  assigneeTeamId: null,
};
const MEMBERS = {
  'u-admin': { role: 'admin' },
  'u-member': { role: 'member' },
  'u-assignee': { role: 'member' },
};
const INBOX: Script = {
  members: MEMBERS,
  messages: { [MESSAGE_ID]: { conversationId: TRIAGE.id } },
  conversations: [TRIAGE],
};

describe('filterRetrievableRagFileIds — email message refs', () => {
  it('admits an email to whoever may read its conversation, for a door that asked', async () => {
    // An unassigned inbox row is admin triage only: the admin reads the
    // body, a plain member of the same organization does not.
    const admin = await dispatch(INBOX, {
      fileIds: [MSG_REF],
      userId: 'u-admin',
      includeConversationMessages: true,
    });
    expect(admin.admitted).toEqual([MSG_REF]);
    const member = await dispatch(INBOX, {
      fileIds: [MSG_REF],
      userId: 'u-member',
      includeConversationMessages: true,
    });
    expect(member.admitted).toEqual([]);
  });

  it('admits it to the conversation assignee', async () => {
    const assigned = { ...TRIAGE, assigneeUserId: 'u-assignee' };
    const { admitted } = await dispatch(
      { ...INBOX, conversations: [assigned] },
      {
        fileIds: [MSG_REF],
        userId: 'u-assignee',
        includeConversationMessages: true,
      },
    );
    expect(admitted).toEqual([MSG_REF]);
  });

  it('never reads a message for a door that did not ask, so it can only deny', async () => {
    const { admitted, statements } = await dispatch(INBOX, {
      fileIds: [MSG_REF],
      userId: 'u-admin',
    });
    expect(admitted).toEqual([]);
    expect(
      statements.some((s) => s.text.includes('app.conversation_messages')),
    ).toBe(false);
  });

  it('denies without an identity on the wire', async () => {
    const { admitted } = await dispatch(INBOX, {
      fileIds: [MSG_REF],
      includeConversationMessages: true,
    });
    expect(admitted).toEqual([]);
  });

  it('reads only inbound email for a message ref', async () => {
    const { statements } = await dispatch(INBOX, {
      fileIds: [MSG_REF],
      userId: 'u-admin',
      includeConversationMessages: true,
    });
    const read = statements.find((s) =>
      s.text.includes('FROM app.conversation_messages m'),
    );
    expect(read?.values).toEqual([ORG, [MESSAGE_ID], 'inbound', 'email']);
  });

  it('never looks a message ref up as a blob, malformed or not', async () => {
    const { admitted, statements } = await dispatch(INBOX, {
      fileIds: [MSG_REF, 'msg: not an id'],
      userId: 'u-admin',
      includeConversationMessages: true,
    });
    expect(admitted).toEqual([MSG_REF]);
    expect(
      statements.some(
        (s) =>
          s.text.includes('app.documents') ||
          s.text.includes('app.file_metadata'),
      ),
    ).toBe(false);
  });

  it('denies a deleted email', async () => {
    const { admitted } = await dispatch(
      { ...INBOX, messages: {} },
      {
        fileIds: [MSG_REF],
        userId: 'u-admin',
        includeConversationMessages: true,
      },
    );
    expect(admitted).toEqual([]);
  });

  it('darkens the mail of a spam or expired conversation', async () => {
    for (const parent of [
      { ...TRIAGE, status: 'spam' },
      { ...TRIAGE, lifecycleStatus: 'expired' },
    ]) {
      const { admitted } = await dispatch(
        { ...INBOX, conversations: [parent] },
        {
          fileIds: [MSG_REF],
          userId: 'u-admin',
          includeConversationMessages: true,
        },
      );
      expect(admitted).toEqual([]);
    }
  });

  it('denies an email under a folder filter or a conversation-scoped opt-out', async () => {
    const underFolder = await dispatch(INBOX, {
      fileIds: [MSG_REF],
      userId: 'u-admin',
      includeConversationMessages: true,
      folder: 'Reports',
    });
    expect(underFolder.admitted).toEqual([]);
    const optedOut = await dispatch(INBOX, {
      fileIds: [MSG_REF],
      userId: 'u-admin',
      includeConversationMessages: true,
      includeConversationScoped: false,
    });
    expect(optedOut.admitted).toEqual([]);
  });

  it('decides an attachment and an email of the same batch from ONE conversation read', async () => {
    const other = { ...TRIAGE, id: 'conv-other' };
    const { admitted, statements } = await dispatch(
      {
        ...INBOX,
        files: { [BLOB_REF]: other.id },
        conversations: [TRIAGE, other],
      },
      {
        fileIds: [BLOB_REF, MSG_REF],
        userId: 'u-admin',
        includeConversationMessages: true,
      },
    );
    expect(admitted).toEqual([BLOB_REF, MSG_REF]);
    const conversationReads = statements.filter((s) =>
      s.text.includes('FROM app.conversations WHERE'),
    );
    expect(conversationReads).toHaveLength(1);
    expect(conversationReads[0]?.values[1]).toEqual(
      expect.arrayContaining([TRIAGE.id, other.id]),
    );
  });
});
