// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkLoadout } from '../../../lib/agent/ladder.ts';
import type { TurnOutcome } from '../../../lib/chat/turn.ts';
import { executeTurn } from '../../core/chat/turn_action.ts';
import { assertChatTurnBudget } from '../chat/budget-admission.ts';
import { eligibleProjectAgentHarnesses } from '../projects/service.ts';
import { releaseLightSession } from '../sandbox/light-sessions.ts';
import { completeAgentRunInTx } from './agent-run-completion.ts';
import { failAgentRunFromTurn, launchAgentRun } from './agent-runs.ts';
import {
  attachRunThread,
  listRunFiles,
  moveRunToHarnessInTx,
} from './native-runs.ts';
import {
  classifyNativeFailure,
  failureOfRefusal,
  nativeTaskPrompt,
  runNativeAgentTurn,
} from './native-turn.ts';
import { missingEquippedSkills, nativeWorkTools } from './native-work-tools.ts';
import { readTaskBrief } from './task-brief-read.ts';

vi.mock('../../core/chat/turn_action.ts', () => ({ executeTurn: vi.fn() }));
vi.mock('../chat/budget-admission.ts', () => ({
  assertChatTurnBudget: vi.fn(),
}));
vi.mock('../chat/shim.ts', () => ({ chatShimHandlers: () => ({}) }));
vi.mock('../chat/store.ts', () => ({
  createPgTurnStore: vi.fn(() => ({
    beginTurn: vi.fn(async () => ({
      assistantMessage: { id: 'm', sequence: 1 },
    })),
  })),
  createPgUsageLedger: vi.fn(() => ({ record: vi.fn() })),
}));
vi.mock('../knowledge/embedding-meter.ts', () => ({ embeddingMeter: vi.fn() }));
vi.mock('../projects/service.ts', () => ({
  eligibleProjectAgentHarnesses: vi.fn(),
}));
vi.mock('../sandbox/light-sessions.ts', () => ({
  releaseLightSession: vi.fn(async () => false),
}));
vi.mock('./agent-language.ts', () => ({
  loadAgentLanguageContext: vi.fn(async () => ({
    defaultLocale: 'de',
    task: { id: 'task-1', title: 'Contacts', description: null },
  })),
}));
vi.mock('./agent-run-completion.ts', () => ({
  completeAgentRunInTx: vi.fn(async () => true),
}));
vi.mock('./agent-runs.ts', () => ({
  failAgentRunFromTurn: vi.fn(async () => true),
  launchAgentRun: vi.fn(async () => true),
}));
vi.mock('./agent-workers.ts', () => ({
  agentRunWorkDeadline: vi.fn(() => 123),
}));
vi.mock('./native-runs.ts', () => ({
  attachRunThread: vi.fn(),
  listRunFiles: vi.fn(),
  moveRunToHarnessInTx: vi.fn(),
}));
vi.mock('./native-work-tools.ts', () => ({
  missingEquippedSkills: vi.fn(async () => []),
  nativeWorkTools: vi.fn(async () => undefined),
}));
vi.mock('./task-brief-read.ts', () => ({ readTaskBrief: vi.fn() }));
vi.mock('@tale/shared/db/serializable', () => ({
  transactSerializable: (sql: unknown, work: (tx: unknown) => unknown) =>
    work(sql),
}));

const INPUT = { organizationId: 'org-1', runId: 'run-1', execId: 'exec-1' };

const RUN = {
  taskId: 'task-1',
  agentId: 'agent-1',
  projectId: 'project-1',
  startedBy: 'user:member-1',
  apiKeyId: null,
  harness: 'claude-code',
  model: 'claude-sonnet-5',
  modelProvider: 'anthropic',
  feedback: null,
  mentionSource: null,
  deadlineAt: 1,
  startedAt: 1,
  launchedAt: null,
  status: 'queued',
  execId: 'exec-1',
  engine: 'native',
};

const AGENT = {
  instructions: 'You are the finance agent.',
  skills: ['docx'],
  connectors: [] as string[],
  tools: [] as string[],
  secrets: [] as string[],
};

const BRIEF = {
  title: 'Contacts',
  description: 'List the onboarding contacts.',
  discussion: [],
  attachments: [{ fileId: 's3:in', fileName: 'brief.pdf' }],
  outputs: [],
};

/** A pool answering the host's two reads and the liveness probe, recording
 * every statement, and the transactions it opens. */
function fakeSql(
  overrides: {
    run?: object | null;
    agent?: object | null;
    live?: boolean;
  } = {},
): Sql & { statements: { text: string; values: unknown[] }[] } {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (
      text.includes('AND exec_id = ') &&
      text.includes("status = 'running'")
    ) {
      return Promise.resolve(overrides.live === false ? [] : [{ id: 'run-1' }]);
    }
    if (text.includes('FROM app.project_agent_runs')) {
      return Promise.resolve(
        overrides.run === null ? [] : [{ ...RUN, ...overrides.run }],
      );
    }
    if (text.includes('FROM app.project_agents')) {
      return Promise.resolve(
        overrides.agent === null ? [] : [{ ...AGENT, ...overrides.agent }],
      );
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(tag, {
    statements,
    begin: (work: (tx: unknown) => unknown) => work(sql),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a tagged-template fake standing in for the pool
  return sql as unknown as Sql & {
    statements: { text: string; values: unknown[] }[];
  };
}

const completed = (text: string, extra: object = {}): TurnOutcome =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the host reads only the status, the text and the cancel flag
  ({
    status: 'completed',
    text,
    steps: [],
    ...extra,
  }) as unknown as TurnOutcome;

const refused = (
  step: 'input-guardrails' | 'output-guardrails' | 'stream',
  reason: string,
  persisted: boolean,
): TurnOutcome => ({
  status: 'refused',
  steps: [],
  step,
  reason,
  persisted,
});

beforeEach(() => {
  vi.mocked(executeTurn).mockReset();
  vi.mocked(assertChatTurnBudget).mockReset().mockResolvedValue(undefined);
  vi.mocked(eligibleProjectAgentHarnesses)
    .mockReset()
    .mockReturnValue(['claude-code']);
  vi.mocked(releaseLightSession).mockClear();
  vi.mocked(completeAgentRunInTx).mockClear();
  vi.mocked(failAgentRunFromTurn).mockClear().mockResolvedValue(true);
  vi.mocked(launchAgentRun).mockReset().mockResolvedValue(true);
  vi.mocked(attachRunThread).mockReset().mockResolvedValue('thread-1');
  vi.mocked(listRunFiles).mockReset().mockResolvedValue([]);
  vi.mocked(moveRunToHarnessInTx).mockReset().mockResolvedValue('exec-2');
  vi.mocked(missingEquippedSkills).mockReset().mockResolvedValue([]);
  vi.mocked(nativeWorkTools).mockReset().mockResolvedValue(undefined);
  vi.mocked(readTaskBrief).mockReset().mockResolvedValue(BRIEF);
});

describe('classifyNativeFailure — what a failed turn is to the run ledger [TASK-R34]', () => {
  it.each([
    [{ code: 'BUDGET_EXCEEDED', message: 'cap reached' }, 'budget_exceeded'],
    ['429 Too Many Requests: rate limit exceeded', 'model_capacity'],
    [
      { code: 'CHAT_MODEL_UNKNOWN', message: 'no such model' },
      'agent_model_missing',
    ],
    [{ code: 'THREAD_BUSY', message: 'busy' }, 'turn_crashed'],
    ['the provider fell over', 'harness_error'],
  ])('reads %j as %s', (error, code) => {
    expect(classifyNativeFailure(error).code).toBe(code);
  });

  it('keeps the provider’s own words as the reason', () => {
    expect(classifyNativeFailure(new Error('upstream said no')).reason).toBe(
      'upstream said no',
    );
  });
});

describe('failureOfRefusal [TASK-R34]', () => {
  it('reads a guardrail that stopped a written exchange as the organization’s policy, which no retry changes', () => {
    expect(
      failureOfRefusal(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the test's own construction
        refused('input-guardrails', 'Blocked: card number', true) as Extract<
          TurnOutcome,
          { status: 'refused' }
        >,
      ),
    ).toEqual({ code: 'policy_refused', reason: 'Blocked: card number' });
  });

  it('reads a refusal before anything was written as the agent’s model not being available', () => {
    expect(
      failureOfRefusal(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the test's own construction
        refused(
          'input-guardrails',
          'Model x is not available for your account.',
          false,
        ) as Extract<TurnOutcome, { status: 'refused' }>,
      ).code,
    ).toBe('agent_model_missing');
  });

  it('classifies a failed stream like any model failure', () => {
    expect(
      failureOfRefusal(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed by the test's own construction
        refused('stream', '429 rate limit exceeded', true) as Extract<
          TurnOutcome,
          { status: 'refused' }
        >,
      ).code,
    ).toBe('model_capacity');
  });
});

describe('nativeTaskPrompt', () => {
  it('names the task files by ref and the delivery by tool, and closes on the report', () => {
    const prompt = nativeTaskPrompt({
      brief: BRIEF,
      feedback: null,
      mentionSource: null,
    });
    expect(prompt).toContain('You are working on this task: Contacts');
    expect(prompt).toContain('- brief.pdf (ref: s3:in)');
    expect(prompt).toContain(
      'Deliverables: make every file you produce with a tool',
    );
    expect(
      prompt.trimEnd().endsWith('posted back to the task for human review.'),
    ).toBe(true);
  });

  it('leads with the comment that sent the run, but not with a description that named the agent', () => {
    expect(
      nativeTaskPrompt({
        brief: BRIEF,
        feedback: 'Add the phone numbers.',
        mentionSource: 'comment',
      }),
    ).toContain('Add the phone numbers.');
    expect(
      nativeTaskPrompt({
        brief: BRIEF,
        feedback: 'List the onboarding contacts.',
        mentionSource: 'description',
      }),
    ).not.toContain('sent back with reviewer feedback');
  });
});

describe('runNativeAgentTurn — the gate', () => {
  it.each([
    ['gone', { run: null }],
    ['launched already', { run: { status: 'running' } }],
    ['another exec’s', { run: { execId: 'exec-0' } }],
    ['a harness run', { run: { engine: 'harness' } }],
  ])('starts nothing for a run that is %s', async (_label, rows) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await runNativeAgentTurn(fakeSql(rows), INPUT);

    expect(launchAgentRun).not.toHaveBeenCalled();
    expect(executeTurn).not.toHaveBeenCalled();
    expect(failAgentRunFromTurn).not.toHaveBeenCalled();
  });

  it('fails a run whose agent is gone as configuration, never retried [TASK-R34]', async () => {
    await runNativeAgentTurn(fakeSql({ agent: null }), INPUT);

    expect(failAgentRunFromTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        runId: 'run-1',
        execId: 'exec-1',
        failureCode: 'agent_deleted',
      }),
    );
    expect(launchAgentRun).not.toHaveBeenCalled();
  });

  it.each([
    ['a schedule started it', { run: { startedBy: 'trigger:t-1' } }],
    ['the agent has connectors', { agent: { connectors: ['github'] } }],
    ['the agent has tools', { agent: { tools: ['t'] } }],
    ['the agent has secrets', { agent: { secrets: ['s'] } }],
  ])(
    'routes the run to the harness before anything runs when %s [TASK-R30]',
    async (_label, rows) => {
      await runNativeAgentTurn(fakeSql(rows), INPUT);

      expect(moveRunToHarnessInTx).toHaveBeenCalledWith(expect.anything(), {
        organizationId: 'org-1',
        runId: 'run-1',
        execId: 'exec-1',
      });
      expect(launchAgentRun).not.toHaveBeenCalled();
      expect(executeTurn).not.toHaveBeenCalled();
    },
  );

  it('refuses a run over a skill its agent equips and its project cannot reach, as the harness does [TASK-R34]', async () => {
    vi.mocked(missingEquippedSkills).mockResolvedValue(['brand-voice']);

    await runNativeAgentTurn(fakeSql(), INPUT);

    expect(failAgentRunFromTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        failureCode: 'equipment_missing',
        error: expect.stringContaining('brand-voice'),
      }),
    );
    expect(launchAgentRun).not.toHaveBeenCalled();
  });

  it('stops quietly when another start won the launch', async () => {
    vi.mocked(launchAgentRun).mockResolvedValue(false);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await runNativeAgentTurn(fakeSql(), INPUT);

    expect(attachRunThread).not.toHaveBeenCalled();
    expect(executeTurn).not.toHaveBeenCalled();
  });
});

describe('runNativeAgentTurn — the turn', () => {
  it('runs the shared engine as the starter, in the run’s thread, on the run’s model, with the brief as the message [TASK-R30]', async () => {
    vi.mocked(executeTurn).mockResolvedValue(completed('Done.'));

    await runNativeAgentTurn(fakeSql({ run: { apiKeyId: 'key-1' } }), INPUT);

    expect(launchAgentRun).toHaveBeenCalledWith(expect.anything(), {
      runId: 'run-1',
      execId: 'exec-1',
      deadlineAt: 123,
    });
    expect(assertChatTurnBudget).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      userId: 'member-1',
      apiKeyId: 'key-1',
      threadId: 'thread-1',
      projectIds: ['project-1'],
    });
    const [, args, overrides] = vi.mocked(executeTurn).mock.calls[0] ?? [];
    expect(args).toMatchObject({
      organizationId: 'org-1',
      userId: 'member-1',
      apiKeyId: 'key-1',
      threadId: 'thread-1',
      expectedProjectId: 'project-1',
      modelId: 'claude-sonnet-5',
      providerSlug: 'anthropic',
      providerStrict: true,
      locale: 'de',
    });
    expect(args?.userText).toContain('You are working on this task: Contacts');
    // The person's own context belongs to a chat with them, not to a task.
    expect(overrides?.personalContext).toBe(false);
    expect(overrides?.signal).toBeInstanceOf(AbortSignal);
  });

  it('speaks as the project agent, in the task’s language, with the ladder its tools make', async () => {
    vi.mocked(executeTurn).mockResolvedValue(completed('Done.'));
    await runNativeAgentTurn(fakeSql(), INPUT);

    const overrides = vi.mocked(executeTurn).mock.calls[0]?.[2];
    const loadout: WorkLoadout = {
      createFile: true,
      generateImage: false,
      skills: true,
      runCode: true,
      escalate: true,
    };
    const persona = overrides?.persona?.(loadout);
    expect(persona?.slug).toBe('agent-1');
    expect(persona?.instructions).toContain('You are the finance agent.');
    expect(persona?.instructions).toContain('MAKING THINGS');
    expect(persona?.instructions).toContain('Task language policy');
  });

  it('hands the work tools the run, its thread, its skills and its task’s files', async () => {
    vi.mocked(executeTurn).mockImplementation(
      async (_ctx, _args, overrides) => {
        await overrides.workTools?.({
          rootThreadId: 'thread-1',
          threadIds: ['thread-1'],
          projectId: 'project-1',
        });
        return completed('Done.');
      },
    );

    await runNativeAgentTurn(fakeSql(), INPUT);

    expect(nativeWorkTools).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org-1',
        projectId: 'project-1',
        agentId: 'agent-1',
        userId: 'member-1',
        runId: 'run-1',
        threadId: 'thread-1',
        skills: ['docx'],
        taskFiles: BRIEF.attachments,
        escalation: expect.any(Object),
      }),
    );
  });

  it('offers no hand-over when the agent’s runtime cannot be started [TASK-R31]', async () => {
    vi.mocked(eligibleProjectAgentHarnesses).mockReturnValue(['codex']);
    vi.mocked(executeTurn).mockImplementation(
      async (_ctx, _args, overrides) => {
        await overrides.workTools?.({
          rootThreadId: 'thread-1',
          threadIds: ['thread-1'],
          projectId: 'project-1',
        });
        return completed('Done.');
      },
    );

    await runNativeAgentTurn(fakeSql(), INPUT);

    expect(vi.mocked(nativeWorkTools).mock.calls[0]?.[1]).not.toHaveProperty(
      'escalation',
    );
  });

  it('refuses a turn the starter’s budget no longer admits, before the model is called [TASK-R32]', async () => {
    vi.mocked(assertChatTurnBudget).mockRejectedValue(
      Object.assign(new Error('Your daily limit is reached.'), {
        code: 'BUDGET_EXCEEDED',
        data: { message: 'Your daily limit is reached.' },
      }),
    );

    await runNativeAgentTurn(fakeSql(), INPUT);

    expect(executeTurn).not.toHaveBeenCalled();
    expect(failAgentRunFromTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        failureCode: 'budget_exceeded',
        error: 'Your daily limit is reached.',
      }),
    );
  });

  it('stops a run whose task or transcript vanished without failing anything', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(attachRunThread).mockResolvedValue(null);

    await runNativeAgentTurn(fakeSql(), INPUT);

    expect(executeTurn).not.toHaveBeenCalled();
    expect(failAgentRunFromTurn).not.toHaveBeenCalled();
  });
});

describe('runNativeAgentTurn — the settle', () => {
  it('settles like a harness run: the files become deliverables, the closing message the report, and the delivery is noticed [TASK-R32]', async () => {
    vi.mocked(executeTurn).mockResolvedValue(completed('  I made the file.  '));
    vi.mocked(listRunFiles).mockResolvedValue([
      {
        fileId: 's3:a',
        fileName: 'contacts.csv',
        fileType: 'text/csv',
        fileSize: 10,
      },
    ]);

    await runNativeAgentTurn(fakeSql(), INPUT);

    expect(completeAgentRunInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org-1',
        taskId: 'task-1',
        agentId: 'agent-1',
        runId: 'run-1',
        execId: 'exec-1',
        resultText: 'I made the file.',
        body: 'I made the file.',
        files: [
          {
            fileId: 's3:a',
            fileName: 'contacts.csv',
            fileType: 'text/csv',
            fileSize: 10,
          },
        ],
        noticeByLocale: expect.objectContaining({
          en: expect.stringContaining('contacts.csv'),
        }),
      }),
    );
    expect(failAgentRunFromTurn).not.toHaveBeenCalled();
  });

  it('fails a turn that made neither a report nor a file, retryable [TASK-R34]', async () => {
    vi.mocked(executeTurn).mockResolvedValue(completed('   '));

    await runNativeAgentTurn(fakeSql(), INPUT);

    expect(completeAgentRunInTx).not.toHaveBeenCalled();
    expect(failAgentRunFromTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ failureCode: 'empty_turn' }),
    );
  });

  it('delivers files alone when the closing message is empty [TASK-R32]', async () => {
    vi.mocked(executeTurn).mockResolvedValue(completed(''));
    vi.mocked(listRunFiles).mockResolvedValue([
      { fileId: 's3:a', fileName: 'a.csv', fileType: 'text/csv', fileSize: 1 },
    ]);

    await runNativeAgentTurn(fakeSql(), INPUT);

    expect(completeAgentRunInTx).toHaveBeenCalledOnce();
  });

  it('hands the run to the harness with the pass’s brief and files when the model asked for the workspace [TASK-R31]', async () => {
    vi.mocked(listRunFiles).mockResolvedValue([
      {
        fileId: 's3:a',
        fileName: 'draft.md',
        fileType: 'text/markdown',
        fileSize: 5,
      },
    ]);
    vi.mocked(executeTurn).mockImplementation(
      async (_ctx, _args, overrides) => {
        // The model's `use_workspace` call reaches the lane through the scope's
        // escalation; the host honours it once the turn has ended.
        await overrides.workTools?.({
          rootThreadId: 'thread-1',
          threadIds: ['thread-1'],
          projectId: 'project-1',
        });
        const escalation =
          vi.mocked(nativeWorkTools).mock.calls[0]?.[1].escalation;
        await expect(
          escalation?.request({ reason: 'needs git', brief: 'Clone it.' }),
        ).resolves.toEqual({ accepted: true });
        return completed('Handing over.');
      },
    );

    await runNativeAgentTurn(fakeSql(), INPUT);

    expect(moveRunToHarnessInTx).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      runId: 'run-1',
      execId: 'exec-1',
      handoff: { reason: 'needs git', brief: 'Clone it.' },
      files: [
        {
          fileId: 's3:a',
          fileName: 'draft.md',
          fileType: 'text/markdown',
          fileSize: 5,
        },
      ],
    });
    // The pass's sentence is not the task's report.
    expect(completeAgentRunInTx).not.toHaveBeenCalled();
    expect(failAgentRunFromTurn).not.toHaveBeenCalled();
  });

  it.each([
    [
      refused('input-guardrails', 'Blocked by the PII policy', true),
      'policy_refused',
    ],
    [refused('stream', 'the provider fell over', true), 'harness_error'],
  ])('fails a refused turn as %s [TASK-R34]', async (outcome, code) => {
    vi.mocked(executeTurn).mockResolvedValue(outcome);

    await runNativeAgentTurn(fakeSql(), INPUT);

    expect(failAgentRunFromTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ failureCode: code }),
    );
    expect(completeAgentRunInTx).not.toHaveBeenCalled();
  });

  it('fails a turn the engine threw on, by what it threw [TASK-R34]', async () => {
    vi.mocked(executeTurn).mockRejectedValue(
      Object.assign(new Error('Credential disabled'), {
        code: 'CREDENTIAL_DISABLED',
      }),
    );

    await runNativeAgentTurn(fakeSql(), INPUT);

    expect(failAgentRunFromTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        failureCode: 'harness_error',
        error: 'Credential disabled',
      }),
    );
  });

  it('leaves a run a Stop ended alone: the failed mark finds it ended and does nothing [TASK-R33]', async () => {
    vi.mocked(executeTurn).mockResolvedValue(
      completed('half', { cancelled: true }),
    );
    vi.mocked(failAgentRunFromTurn).mockResolvedValue(false);

    await runNativeAgentTurn(fakeSql(), INPUT);

    expect(completeAgentRunInTx).not.toHaveBeenCalled();
    expect(failAgentRunFromTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ failureCode: 'turn_crashed' }),
    );
  });

  it('fails a run a worker shutdown cut short as interrupted, which retries [TASK-R34]', async () => {
    const shutdown = new AbortController();
    shutdown.abort();
    vi.mocked(executeTurn).mockResolvedValue(
      completed('half', { cancelled: true }),
    );

    await runNativeAgentTurn(fakeSql(), INPUT, { signal: shutdown.signal });

    expect(vi.mocked(executeTurn).mock.calls[0]?.[2].signal?.aborted).toBe(
      true,
    );
    expect(failAgentRunFromTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        failureCode: 'turn_crashed',
        error: expect.stringContaining('worker stopped'),
      }),
    );
  });

  it('fails a run that outlasted its time limit as past its deadline, which does not retry [TASK-R34]', async () => {
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(AbortSignal.abort());
    try {
      vi.mocked(executeTurn).mockResolvedValue(
        completed('half', { cancelled: true }),
      );

      await runNativeAgentTurn(fakeSql(), INPUT);

      expect(failAgentRunFromTurn).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ failureCode: 'deadline' }),
      );
    } finally {
      timeout.mockRestore();
    }
  });

  describe('the run’s turn store [TASK-R33]', () => {
    /** The store the engine writes through, as `executeTurn` receives it. */
    async function openTurn(sql: ReturnType<typeof fakeSql>) {
      vi.mocked(executeTurn).mockImplementation(
        async (_ctx, args, overrides) => {
          await overrides.deps.store.beginTurn({
            organizationId: args.organizationId,
            threadId: args.threadId,
            userParts: [{ type: 'text', text: args.userText }],
          });
          return completed('Done.');
        },
      );
      await runNativeAgentTurn(sql, INPUT);
    }

    it('flags the turn to stop when the run was ended before its generation row existed', async () => {
      const sql = fakeSql({ live: false });
      await openTurn(sql);

      const flag = sql.statements.find((statement) =>
        statement.text.includes('SET cancel_requested = true'),
      );
      expect(flag?.values).toEqual(['thread-1', 'org-1']);
    });

    it('lets a turn of a live run work', async () => {
      const sql = fakeSql({ live: true });
      await openTurn(sql);

      expect(
        sql.statements.some((statement) =>
          statement.text.includes('SET cancel_requested = true'),
        ),
      ).toBe(false);
    });
  });

  it('lets a crash outside the turn fail the run instead of stranding it [TASK-R34]', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(readTaskBrief).mockRejectedValue(new Error('database went away'));

    await runNativeAgentTurn(fakeSql(), INPUT);

    expect(failAgentRunFromTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        failureCode: 'turn_crashed',
        error: 'database went away',
      }),
    );
  });

  it.each([
    ['completes', async () => completed('Done.')],
    ['is refused', async () => refused('stream', 'boom', true)],
    [
      'throws',
      async (): Promise<TurnOutcome> => {
        throw new Error('boom');
      },
    ],
  ])(
    'gives the light sandbox back when the turn %s [TASK-R32]',
    async (_label, outcome) => {
      vi.mocked(executeTurn).mockImplementation(outcome);

      await runNativeAgentTurn(fakeSql(), INPUT);

      expect(releaseLightSession).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        { organizationId: 'org-1', ownerKey: 'run-1' },
      );
    },
  );
});
