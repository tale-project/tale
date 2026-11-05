// @vitest-environment node

/**
 * A project's default chat agent: who its new chats start with. Editors and
 * admins choose it on an active project, against the value their page read;
 * readers see it with the agents a chat may answer as.
 */

import type { TransactionSql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readProjectChatAgents, setProjectChatAgent } from './service.ts';

const { createAuditLog } = vi.hoisted(() => ({ createAuditLog: vi.fn() }));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));

const PROJECT = {
  id: 'project-1',
  organizationId: 'org_1',
  name: 'Website relaunch',
  teamIds: [] as string[],
  teamId: null,
  sharedWithTeamIds: [] as string[],
  archivedAt: null as number | null,
  createdBy: 'user-1',
  defaultChatAgentId: null as string | null,
  chatsStartWithAssistant: false,
};

/** The project's own agents, oldest first (the standard agent is never
 * among them: the read filters it). */
const AGENTS = [
  { id: 'agent-old', name: 'Copy reviewer' },
  { id: 'agent-new', name: 'Coder' },
];

const editor = {
  organizationId: 'org_1',
  userId: 'user-1',
  role: 'editor',
  teamIds: [] as string[],
};

interface Statement {
  text: string;
  values: unknown[];
}

function fakeTx(project: Partial<typeof PROJECT> = {}): {
  tx: TransactionSql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('FROM app.projects WHERE id = ?')) {
      return Promise.resolve([{ ...PROJECT, ...project }]);
    }
    if (text.includes('FROM app.project_agents')) {
      return Promise.resolve(AGENTS);
    }
    return Promise.resolve([]);
  };
  const tx = Object.assign(run, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for the postgres.js transaction
  return { tx: tx as unknown as TransactionSql, statements };
}

const writes = (statements: Statement[]) =>
  statements.filter((s) => s.text.startsWith('UPDATE app.projects'));

afterEach(() => {
  vi.clearAllMocks();
});

describe('readProjectChatAgents [PROJ-R26]', () => {
  it('answers the project’s own agents, the choice, and the agent it means now', async () => {
    const { tx } = fakeTx();
    await expect(
      readProjectChatAgents(tx, editor, 'project-1'),
    ).resolves.toEqual({
      chatAgent: { kind: 'first' },
      defaultAgentId: 'agent-old',
      agents: AGENTS,
    });
    const named = fakeTx({ defaultChatAgentId: 'agent-new' });
    await expect(
      readProjectChatAgents(named.tx, editor, 'project-1'),
    ).resolves.toMatchObject({
      chatAgent: { kind: 'agent', agentId: 'agent-new' },
      defaultAgentId: 'agent-new',
    });
    const assistant = fakeTx({ chatsStartWithAssistant: true });
    await expect(
      readProjectChatAgents(assistant.tx, editor, 'project-1'),
    ).resolves.toMatchObject({
      chatAgent: { kind: 'assistant' },
      defaultAgentId: null,
    });
  });
});

describe('setProjectChatAgent [PROJ-R28]', () => {
  it('names an agent of the project, and audits the change', async () => {
    const { tx, statements } = fakeTx();
    await expect(
      setProjectChatAgent(tx, editor, 'project-1', {
        chatAgent: { kind: 'agent', agentId: 'agent-new' },
        expected: { kind: 'first' },
      }),
    ).resolves.toEqual({
      chatAgent: { kind: 'agent', agentId: 'agent-new' },
    });
    const [update] = writes(statements);
    expect(update?.values.slice(0, 2)).toEqual(['agent-new', false]);
    expect(createAuditLog).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        previousState: { chatAgent: { kind: 'first' } },
        newState: { chatAgent: { kind: 'agent', agentId: 'agent-new' } },
        changedFields: ['chatAgent'],
      }),
    );
  });

  it('starts the project’s chats with the assistant, or back with the first agent created', async () => {
    const toAssistant = fakeTx();
    await setProjectChatAgent(toAssistant.tx, editor, 'project-1', {
      chatAgent: { kind: 'assistant' },
      expected: { kind: 'first' },
    });
    expect(writes(toAssistant.statements)[0]?.values.slice(0, 2)).toEqual([
      null,
      true,
    ]);
    const back = fakeTx({ chatsStartWithAssistant: true });
    await setProjectChatAgent(back.tx, editor, 'project-1', {
      chatAgent: { kind: 'first' },
      expected: { kind: 'assistant' },
    });
    expect(writes(back.statements)[0]?.values.slice(0, 2)).toEqual([
      null,
      false,
    ]);
  });

  it('refuses a save made from an outdated page, writing nothing', async () => {
    const { tx, statements } = fakeTx({ defaultChatAgentId: 'agent-old' });
    await expect(
      setProjectChatAgent(tx, editor, 'project-1', {
        chatAgent: { kind: 'assistant' },
        expected: { kind: 'first' },
      }),
    ).rejects.toMatchObject({
      code: 'PROJECT_CHAT_AGENT_STALE',
      status: 409,
    });
    expect(writes(statements)).toEqual([]);
  });

  it('refuses an agent that is not one of the project’s own', async () => {
    const { tx, statements } = fakeTx();
    await expect(
      setProjectChatAgent(tx, editor, 'project-1', {
        chatAgent: { kind: 'agent', agentId: 'standard-agent' },
        expected: { kind: 'first' },
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_CHAT_AGENT_INVALID' });
    expect(writes(statements)).toEqual([]);
  });

  it('refuses a member, and anyone while the project is archived', async () => {
    const member = fakeTx();
    await expect(
      setProjectChatAgent(
        member.tx,
        { ...editor, role: 'member' },
        'project-1',
        {
          chatAgent: { kind: 'assistant' },
          expected: { kind: 'first' },
        },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(writes(member.statements)).toEqual([]);
    const archived = fakeTx({ archivedAt: 1_700_000_000_000 });
    await expect(
      setProjectChatAgent(archived.tx, editor, 'project-1', {
        chatAgent: { kind: 'assistant' },
        expected: { kind: 'first' },
      }),
    ).rejects.toThrow();
    expect(writes(archived.statements)).toEqual([]);
  });

  it('writes nothing when the choice is the one already saved', async () => {
    const { tx, statements } = fakeTx({ defaultChatAgentId: 'agent-old' });
    await setProjectChatAgent(tx, editor, 'project-1', {
      chatAgent: { kind: 'agent', agentId: 'agent-old' },
      expected: { kind: 'agent', agentId: 'agent-old' },
    });
    expect(writes(statements)).toEqual([]);
    expect(createAuditLog).not.toHaveBeenCalled();
  });
});
