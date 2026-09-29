import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  connectorSchema,
  type ConnectorAction,
} from '@tale/shared/schemas/connectors';
import { describe, expect, it, vi } from 'vitest';

import {
  importedTaskTitleRefusal,
  TASK_TITLE_MAX,
  truncateImportedTitle,
} from '../../../backend/core/tasks/helpers';
import { nodeVmRunner } from '../../engine/runners/node-vm';
import { parseYamlOrThrow } from '../../shared/config/yaml';
import { platformTaskNatives } from './platform-tasks';

const bodies = {
  en: 'Checked.',
  de: 'Geprüft.',
  fr: 'Vérifié.',
  'de-CH': 'Geprüft.',
  nl: 'Gecontroleerd.',
  it: 'Verificato.',
};

describe('localized workflow task comments', () => {
  it('returns locale maps after filtering the native comment window', async () => {
    const listComments = vi.fn().mockResolvedValue({
      comments: [
        {
          authorType: 'agent',
          authorId: 'workflow',
          body: 'anchor',
          createdAt: 1,
        },
        {
          authorType: 'agent',
          authorId: 'workflow',
          body: 'Geprüft.',
          bodyByLocale: bodies,
          createdAt: 2,
        },
      ],
      truncated: false,
    });
    const native = platformTaskNatives({ listComments } as never)[
      'task.list_comments'
    ];
    await expect(
      native?.(
        {
          taskId: 't-1',
          afterMarker: 'anchor',
          authorTypes: ['agent'],
          limit: 1,
        },
        { organizationId: 'org-1' } as never,
      ),
    ).resolves.toMatchObject({
      count: 1,
      comments: [{ body: 'Geprüft.', bodyByLocale: bodies }],
    });
  });

  it('accepts and preserves extra UI language and regional translations', async () => {
    const comment = vi.fn().mockResolvedValue({ messageId: 'm-1' });
    const native = platformTaskNatives({ comment } as never)['task.comment'];
    await expect(
      native?.({ taskId: 't-1', body: 'Geprüft.', bodyByLocale: bodies }, {
        organizationId: 'org-1',
      } as never),
    ).resolves.toEqual({ messageId: 'm-1' });
    expect(comment).toHaveBeenCalledWith({
      organizationId: 'org-1',
      taskId: 't-1',
      body: 'Geprüft.',
      bodyByLocale: bodies,
    });
  });

  it.each([
    { en: 'Checked.', de: 'Geprüft.' },
    { ...bodies, invalid_locale: 'No.' },
    { ...bodies, nl: 42 },
    {
      ...bodies,
      ...Object.fromEntries(
        Array.from({ length: 20 }, (_, index) => [
          `a${String.fromCharCode(97 + index)}`,
          'Translated.',
        ]),
      ),
    },
  ])(
    'refuses incomplete or invalid locale maps before writing',
    async (bodyByLocale) => {
      const comment = vi.fn();
      const native = platformTaskNatives({ comment } as never)['task.comment'];
      await expect(
        native?.({ taskId: 't-1', body: 'Checked.', bodyByLocale }, {
          organizationId: 'org-1',
        } as never),
      ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
      expect(comment).not.toHaveBeenCalled();
    },
  );
});

describe('external issue task intake', () => {
  const input = {
    projectId: 'project-1',
    externalSystem: 'github',
    externalId: 'example/web#1',
    title: 'Issue',
    externalUrl: 'https://github.com/example/web/issues/1',
  };
  const issue = {
    externalSystem: 'github',
    externalId: 'example/web#1',
    title: 'Issue',
  };

  it('takes organization and caller from the trusted context', async () => {
    const upsert = vi
      .fn()
      .mockResolvedValue({ taskId: 'task-1', created: true, title: 'Issue' });
    const native = platformTaskNatives({ upsert } as never)['task.upsert'];
    const caller = { kind: 'workflow', runId: 'run-1', nodeId: 'tasks' };
    await expect(
      native?.(input, { organizationId: 'org-1', caller } as never),
    ).resolves.toEqual({ taskId: 'task-1', created: true, title: 'Issue' });
    expect(upsert).toHaveBeenCalledWith({
      ...input,
      organizationId: 'org-1',
      caller,
    });
  });

  /**
   * The title a workflow reads back is the one the task carries: the store's
   * answer, cut to the board's cap on a create and kept as stored by a
   * source-snapshot reconcile. The native used to echo the title it was
   * sent — trimmed, but uncut and up to 10,000 units.
   */
  it('answers the title the task carries, not the one it was sent', async () => {
    const long = 'L'.repeat(TASK_TITLE_MAX + 50);
    const upsert = vi.fn().mockResolvedValue({
      taskId: 'task-1',
      created: false,
      title: 'Renamed in Tale',
    });
    const upsertIssues = vi
      .fn()
      .mockResolvedValue([
        { taskId: 'task-2', created: true, title: truncateImportedTitle(long) },
      ]);
    const natives = platformTaskNatives({ upsert, upsertIssues } as never);
    const caller = { kind: 'workflow', runId: 'run-1', nodeId: 'tasks' };
    await expect(
      natives['task.upsert']?.({ ...input, title: long }, {
        organizationId: 'org-1',
        caller,
      } as never),
    ).resolves.toEqual({
      taskId: 'task-1',
      created: false,
      title: 'Renamed in Tale',
    });
    await expect(
      natives['task.upsert_issues']?.(
        { projectId: 'project-1', issues: [{ ...issue, title: long }] },
        { organizationId: 'org-1', caller } as never,
      ),
    ).resolves.toEqual([
      { taskId: 'task-2', created: true, title: `${'L'.repeat(199)}…` },
    ]);
  });

  /**
   * A blank title names nothing, and every task door answers it with the
   * one empty-title sentence — the agent's upsert, the app's intake and now
   * both natives, which used to answer the validator's "title Too small:
   * expected string to have >=1 characters". A batch names the item.
   */
  it.each(['', '   ', '\n\t '])(
    'refuses a blank title %j with the empty-title sentence, before writing',
    async (title) => {
      const upsert = vi.fn();
      const upsertIssues = vi.fn();
      const natives = platformTaskNatives({ upsert, upsertIssues } as never);
      const caller = { kind: 'workflow', runId: 'run-1', nodeId: 'tasks' };
      const sentence =
        'The task title is empty — it takes 1 to 200 UTF-16 code units.';
      expect(importedTaskTitleRefusal(title)).toBe(sentence);
      await expect(
        natives['task.upsert']?.({ ...input, title }, {
          organizationId: 'org-1',
          caller,
        } as never),
      ).rejects.toMatchObject({ code: 'INPUT_INVALID', message: sentence });
      await expect(
        natives['task.upsert_issues']?.(
          {
            projectId: 'project-1',
            issues: [issue, { ...issue, externalId: 'example/web#2', title }],
          },
          { organizationId: 'org-1', caller } as never,
        ),
      ).rejects.toMatchObject({
        code: 'INPUT_INVALID',
        message: `issues.1: ${sentence}`,
      });
      expect(upsert).not.toHaveBeenCalled();
      expect(upsertIssues).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ...input, projectId: ' ' },
    { ...input, externalId: '' },
    { ...input, externalUrl: 'javascript:alert(1)' },
    { ...input, externalState: 'closed' },
    { ...input, organizationId: 'foreign' },
    { ...input, description: 'x'.repeat(100001) },
  ])('rejects invalid input before writing', async (invalid) => {
    const upsert = vi.fn();
    const native = platformTaskNatives({ upsert } as never)['task.upsert'];
    await expect(
      native?.(invalid, { organizationId: 'org-1' } as never),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses a missing caller even with valid input', async () => {
    const upsert = vi.fn();
    await expect(
      platformTaskNatives({ upsert } as never)['task.upsert']?.(input, {
        organizationId: 'org-1',
      } as never),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect(upsert).not.toHaveBeenCalled();
  });
});

/**
 * A test run answers from the connector's mock, a live run from the task
 * domain. The two used to part at the title: the mocks echoed it as sent
 * and took a blank one. Each mock now cuts and refuses as the domain does —
 * run here in the engine's own node-vm runner against the helpers the
 * domain uses.
 */
describe('the task connector mocks mirror the import domain', () => {
  const connector = connectorSchema.parse(
    parseYamlOrThrow(
      readFileSync(
        path.join(
          path.dirname(new URL(import.meta.url).pathname),
          '../../../../../configs/platform/system/connectors/task/connector.yml',
        ),
        'utf8',
      ),
      { maxBytes: 1024 * 1024 },
    ),
  );
  const mockOf = (name: string): ConnectorAction['mock'] => {
    const action = connector.actions.find((entry) => entry.name === name);
    if (action === undefined) throw new Error(`no task.${name} action`);
    return action.mock;
  };
  const runner = nodeVmRunner();
  const limits = { timeoutMs: 2000 };
  const ref = { externalSystem: 'github', externalId: 'example/web#1' };
  const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
  const titles = [
    'Short',
    '  Padded  ',
    'x'.repeat(TASK_TITLE_MAX),
    'x'.repeat(TASK_TITLE_MAX + 1),
    `${'a'.repeat(TASK_TITLE_MAX - 3)}${family} more`,
    `${'a'.repeat(TASK_TITLE_MAX - 3)}\u{1F1E8}\u{1F1ED} more`,
    `${'a'.repeat(TASK_TITLE_MAX - 2)}e\u0301 more`,
    'y'.repeat(10_000),
  ];

  it('cuts every title the way the domain stores it', async () => {
    const one = mockOf('upsert');
    const batch = mockOf('upsert_issues');
    for (const title of titles) {
      await expect(
        runner.runBody(
          one,
          { input: { projectId: 'p', ...ref, title } },
          limits,
        ),
      ).resolves.toMatchObject({ title: truncateImportedTitle(title) });
    }
    await expect(
      runner.runBody(
        batch,
        {
          input: {
            projectId: 'p',
            issues: titles.map((title) => ({ ...ref, title })),
          },
        },
        limits,
      ),
    ).resolves.toEqual(
      titles.map((title) =>
        expect.objectContaining({ title: truncateImportedTitle(title) }),
      ),
    );
  });

  it('refuses a blank title with the domain sentence, the batch by item', async () => {
    const sentence = importedTaskTitleRefusal(' ');
    expect(sentence).not.toBeNull();
    await expect(
      runner.runBody(
        mockOf('upsert'),
        { input: { projectId: 'p', ...ref, title: ' ' } },
        limits,
      ),
    ).rejects.toThrow(sentence ?? '');
    await expect(
      runner.runBody(
        mockOf('upsert_issues'),
        {
          input: {
            projectId: 'p',
            issues: [
              { ...ref, title: 'Fine' },
              { ...ref, title: '' },
            ],
          },
        },
        limits,
      ),
    ).rejects.toThrow(`issues.1: ${sentence ?? ''}`);
  });
});

/**
 * `task.start_agent`: an automation step puts the task's project agent to
 * work. The rim narrows the input and insists on the workflow caller; the
 * store (`backend/domains/connectors/task-store.ts`) decides who the run
 * answers to and whether it may start — its lanes prove that natively.
 */
describe('task.start_agent', () => {
  const caller = { kind: 'workflow', runId: 'run-1', nodeId: 'start' };
  const started = {
    started: true,
    runId: 'agent-run-1',
    taskId: 'task-1',
    agentId: 'agent-1',
  };

  it('hands the store the step, the task and what the run addresses first', async () => {
    const startAgent = vi.fn().mockResolvedValue(started);
    const native = platformTaskNatives({ startAgent } as never)[
      'task.start_agent'
    ];
    await expect(
      native?.(
        {
          taskId: 'task-1',
          agentId: 'agent-1',
          feedback: 'Scheduled occurrence 2026-09-30 09:00 Europe/Zurich.',
          moveToInProgress: false,
        },
        { organizationId: 'org-1', caller } as never,
      ),
    ).resolves.toEqual(started);
    expect(startAgent).toHaveBeenCalledWith({
      organizationId: 'org-1',
      caller,
      taskId: 'task-1',
      agentId: 'agent-1',
      feedback: 'Scheduled occurrence 2026-09-30 09:00 Europe/Zurich.',
      moveToInProgress: false,
    });
  });

  it('passes a start that started nothing through as data', async () => {
    const busy = {
      started: false,
      reason: 'agent_busy',
      runId: 'agent-run-2',
      busyTaskId: 'task-2',
      taskId: 'task-1',
      agentId: 'agent-1',
    };
    const startAgent = vi.fn().mockResolvedValue(busy);
    await expect(
      platformTaskNatives({ startAgent } as never)['task.start_agent']?.(
        { taskId: 'task-1' },
        { organizationId: 'org-1', caller } as never,
      ),
    ).resolves.toEqual(busy);
  });

  it.each([
    [{ organizationId: 'org-1' }],
    [{ organizationId: 'org-1', caller: { kind: 'user', userId: 'user-1' } }],
    [
      {
        organizationId: 'org-1',
        caller: { kind: 'system', reason: 'itest' },
      },
    ],
  ])('runs only as an automation step (%o)', async (ctx) => {
    const startAgent = vi.fn();
    await expect(
      platformTaskNatives({ startAgent } as never)['task.start_agent']?.(
        { taskId: 'task-1' },
        ctx as never,
      ),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect(startAgent).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { taskId: '' },
    { taskId: 'task-1', feedback: 'x'.repeat(10_001) },
    { taskId: 'task-1', moveToInProgress: 'no' },
    { taskId: 'task-1', projectId: 'project-2' },
  ])('refuses %o before starting anything', async (input) => {
    const startAgent = vi.fn();
    await expect(
      platformTaskNatives({ startAgent } as never)['task.start_agent']?.(
        input,
        { organizationId: 'org-1', caller } as never,
      ),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect(startAgent).not.toHaveBeenCalled();
  });

  it('answers a test run from its mock, in the shape a live run answers', async () => {
    const connector = connectorSchema.parse(
      parseYamlOrThrow(
        readFileSync(
          path.join(
            path.dirname(new URL(import.meta.url).pathname),
            '../../../../../configs/platform/system/connectors/task/connector.yml',
          ),
          'utf8',
        ),
        { maxBytes: 1024 * 1024 },
      ),
    );
    const action = connector.actions.find(
      (entry) => entry.name === 'start_agent',
    );
    expect(action?.effects).toBe('write');
    expect(action?.backend).toEqual({
      kind: 'native',
      impl: 'task.start_agent',
    });
    await expect(
      nodeVmRunner().runBody(
        action?.mock ?? '',
        { input: { taskId: 'task-1', agentId: 'agent-1' } },
        { timeoutMs: 2000 },
      ),
    ).resolves.toEqual({
      started: true,
      runId: 'run_mock',
      taskId: 'task-1',
      agentId: 'agent-1',
    });
  });
});
