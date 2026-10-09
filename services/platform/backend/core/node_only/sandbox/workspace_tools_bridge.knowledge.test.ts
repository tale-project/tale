/**
 * `knowledge_entry_write` and the agents' `knowledge_entry_find` at the
 * workspace-tool bridge: the write runs with the session's own write
 * authority over documents (entries are document-backed), hands the domain
 * the acting agent and the organization the token names, and relays each
 * answer in the shape the model acts on — a saved version, a refusal with
 * the current text to merge from, or a budget to wait for. The find looks
 * in the content as well as the topic. The domain's write itself is pinned
 * by the entries service's tests; here it is the mutation the bridge calls.
 */

import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../../lib/shared/errors/app-error';
import { functionRefName } from '../../../../lib/shared/handlers/function-refs';
import {
  dispatchWorkspaceToolImpl,
  workspaceToolStatusImpl,
} from './workspace_tools_bridge';

vi.mock('../../lib/helpers/org_slug', () => ({
  orgSlugFromId: () => Promise.resolve('acme'),
}));

const ACTION_FN = 'sandbox/workspace_access:resolveSessionActionContext';
const WRITE_FN = 'knowledge_entries/internal_mutations:upsertEntryForAgent';

const PROJECT_AGENT = {
  allowed: true,
  actorId: 'agent_7',
  scope: { kind: 'project', projectId: 'proj_1' },
};

function createCtx(
  options: {
    actionContext?: Record<string, unknown>;
    write?: (args: Record<string, unknown>) => Promise<unknown>;
    read?: (args: Record<string, unknown>) => Promise<unknown>;
  } = {},
) {
  const runQuery = vi.fn(
    (ref: unknown, args: Record<string, unknown>): Promise<unknown> => {
      if (functionRefName(ref) === ACTION_FN) {
        return Promise.resolve(options.actionContext ?? PROJECT_AGENT);
      }
      return options.read?.(args) ?? Promise.resolve(null);
    },
  );
  const runMutation = vi.fn(
    (ref: unknown, args: Record<string, unknown>): Promise<unknown> =>
      functionRefName(ref) === WRITE_FN
        ? (options.write?.(args) ?? Promise.resolve(null))
        : Promise.resolve(null),
  );
  const writes = () =>
    runMutation.mock.calls.filter(([ref]) => functionRefName(ref) === WRITE_FN);
  return {
    ctx: { runQuery, runMutation, runAction: vi.fn() },
    runQuery,
    writes,
  };
}

async function call(
  ctx: ReturnType<typeof createCtx>['ctx'],
  tool: string,
  callArgs: Record<string, unknown>,
) {
  return dispatchWorkspaceToolImpl(ctx as never, {
    organizationId: 'org_1',
    sessionId: 'pa-agent_7',
    tool,
    callArgs,
  });
}

describe('knowledge_entry_write saves a fact as the acting agent [KENTRY-R10]', () => {
  it('writes with the session’s write authority over documents, for the token’s organization', async () => {
    const write = vi.fn(() =>
      Promise.resolve({
        outcome: 'created',
        versionId: 'version_1',
        documentId: 'doc_1',
        topic: 'Support hours',
      }),
    );
    const { ctx, runQuery, writes } = createCtx({ write });

    const result = await call(ctx, 'knowledge_entry_write', {
      topic: 'Support hours',
      content: 'Mon–Fri 8–18',
      organizationId: 'org_EVIL',
    });

    expect(result).toEqual({
      status: 'ok',
      output: {
        outcome: 'created',
        versionId: 'version_1',
        topic: 'Support hours',
        documentId: 'doc_1',
        note: expect.stringContaining('rag_search finds it only once'),
      },
    });
    const [, gate] = runQuery.mock.calls.find(
      ([ref]) => functionRefName(ref) === ACTION_FN,
    ) as [unknown, Record<string, unknown>];
    expect(gate).toMatchObject({ subject: 'documents', effect: 'write' });
    expect(writes()).toHaveLength(1);
    expect(write).toHaveBeenCalledWith({
      organizationId: 'org_1',
      actorId: 'agent_7',
      topic: 'Support hours',
      content: 'Mon–Fri 8–18',
    });
  });

  it('passes the version it read on, and says when nothing changed', async () => {
    const write = vi.fn(() =>
      Promise.resolve({
        outcome: 'unchanged',
        versionId: 'version_1',
        documentId: 'doc_1',
        topic: 'Support hours',
      }),
    );
    const { ctx } = createCtx({
      write,
      actionContext: {
        allowed: true,
        actorId: 'automation:intake',
        scope: { kind: 'org' },
      },
    });

    const result = await call(ctx, 'knowledge_entry_write', {
      topic: 'Support hours',
      content: 'Mon–Fri 8–18',
      expectedVersionId: ' version_1 ',
    });

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'automation:intake',
        expectedVersionId: 'version_1',
      }),
    );
    expect(result).toMatchObject({
      status: 'ok',
      output: {
        outcome: 'unchanged',
        note: expect.stringContaining('nothing'),
      },
    });
  });

  it('refuses malformed arguments before anything is written', async () => {
    const { ctx, writes } = createCtx();
    for (const callArgs of [
      { topic: 'Support hours' },
      { topic: '   ', content: 'Mon–Fri 8–18' },
      { topic: 't'.repeat(121), content: 'Mon–Fri 8–18' },
      { topic: 'Support hours', content: 'c'.repeat(8001) },
      { topic: 'Support hours', content: 'Mon–Fri 8–18', expectedVersionId: 7 },
    ]) {
      expect(await call(ctx, 'knowledge_entry_write', callArgs)).toMatchObject({
        status: 'invalid_args',
      });
    }
    expect(
      await call(ctx, 'knowledge_entry_write', {
        topic: 't'.repeat(121),
        content: 'x',
      }),
    ).toEqual({
      status: 'invalid_args',
      message:
        'The topic is capped at 120 UTF-16 code units (most emoji count as 2); this one has 121.',
    });
    expect(writes()).toEqual([]);
  });

  it('answers a coded domain refusal as invalid_args and a store failure as an error', async () => {
    const refused = createCtx({
      write: () =>
        Promise.reject(
          new AppError({
            code: 'KNOWLEDGE_ENTRY_CONTENT_TOO_LONG',
            message: 'Invalid topic or content',
          }),
        ),
    });
    expect(
      await call(refused.ctx, 'knowledge_entry_write', {
        topic: 'Support hours',
        content: 'Mon–Fri 8–18',
      }),
    ).toMatchObject({
      status: 'invalid_args',
      message: expect.stringContaining('KNOWLEDGE_ENTRY_CONTENT_TOO_LONG'),
    });

    const timedOut = createCtx({
      write: () =>
        Promise.reject(
          new Error('The object store did not accept the entry in time'),
        ),
    });
    expect(
      await call(timedOut.ctx, 'knowledge_entry_write', {
        topic: 'Support hours',
        content: 'Mon–Fri 8–18',
      }),
    ).toMatchObject({ status: 'error' });
  });

  it('is unavailable on a session that acts for nobody', async () => {
    const { ctx, writes } = createCtx({
      actionContext: { allowed: false, reason: 'no_access_context' },
    });
    expect(
      await call(ctx, 'knowledge_entry_write', {
        topic: 'Support hours',
        content: 'Mon–Fri 8–18',
      }),
    ).toMatchObject({
      status: 'unavailable',
      blockers: [{ code: 'no_access_context' }],
    });
    expect(writes()).toEqual([]);
  });
});

describe('knowledge_entry_write onto a fact that changed [KENTRY-R12]', () => {
  it('relays the refusal with the current text and how to merge it', async () => {
    const current = {
      versionId: 'version_2',
      topic: 'Return window',
      content: '45 days',
      updatedAt: 1_700_000_100_000,
    };
    const { ctx } = createCtx({
      write: () =>
        Promise.resolve({
          outcome: 'refused',
          reason: 'version_conflict',
          current,
        }),
    });

    const result = await call(ctx, 'knowledge_entry_write', {
      topic: 'Return window',
      content: '30 days',
      expectedVersionId: 'version_1',
    });

    expect(result).toEqual({
      status: 'ok',
      output: {
        outcome: 'refused',
        reason: 'version_conflict',
        guidance: expect.stringContaining(
          'expectedVersionId: current.versionId',
        ),
        current,
      },
    });
  });
});

describe('knowledge_entry_write on a spent agent budget [KENTRY-R13]', () => {
  it('answers unavailable with the time to wait', async () => {
    const { ctx } = createCtx({
      write: () =>
        Promise.resolve({ outcome: 'rate_limited', retryAfterMs: 2_400 }),
    });
    expect(
      await call(ctx, 'knowledge_entry_write', {
        topic: 'Support hours',
        content: 'Mon–Fri 8–18',
      }),
    ).toEqual({
      status: 'unavailable',
      blockers: [
        {
          code: 'rate_limited',
          guidance: expect.stringContaining('Try again in 3 s'),
        },
      ],
    });
  });
});

describe('knowledge_entry_find for agents', () => {
  it('looks in the content as well as the topic', async () => {
    const read = vi.fn(() =>
      Promise.resolve({ page: [], isDone: true, continueCursor: '' }),
    );
    const { ctx } = createCtx({ read });
    await call(ctx, 'knowledge_entry_find', { topic: 'opening hours' });
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        topic: 'opening hours',
        matchContent: true,
      }),
    );
  });
});

describe('the knowledge tools in the status listing', () => {
  const describedAs = (name: string): string => {
    const tools = workspaceToolStatusImpl([name]).tools as {
      name: string;
      description: string;
      readOnly: boolean;
    }[];
    return tools.find((tool) => tool.name === name)?.description ?? '';
  };

  it('badges the write as a write and states its limits and reach', () => {
    const tools = workspaceToolStatusImpl([
      'knowledge_entry_find',
      'knowledge_entry_write',
    ]).tools as { name: string; readOnly: boolean }[];
    expect(tools).toEqual([
      expect.objectContaining({ name: 'knowledge_entry_find', readOnly: true }),
      expect.objectContaining({
        name: 'knowledge_entry_write',
        readOnly: false,
      }),
    ]);
    const write = describedAs('knowledge_entry_write');
    expect(write).toContain('topic: string (≤ 120 UTF-16 code units)');
    expect(write).toContain(
      'content: string (markdown, ≤ 8,000 UTF-16 code units)',
    );
    expect(write).toContain('Most emoji count as 2 code units.');
    expect(write).toContain('org-wide');
    expect(write).toContain('never secrets, credentials or personal data');
    expect(write).toContain('expectedVersionId');
    expect(write).toContain(
      'rag_search finds it only after it has been indexed',
    );
  });

  it('tells the model which entries an agent wrote', () => {
    const find = describedAs('knowledge_entry_find');
    expect(find).toContain('source "agent"');
    expect(find).toContain('expectedVersionId');
  });
});
