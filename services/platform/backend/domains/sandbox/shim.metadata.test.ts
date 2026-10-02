import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { updateAgentTaskMetadata } from '../tasks/agent-metadata.ts';
import { sandboxToolShimHandlers } from './shim.ts';

vi.mock('../tasks/agent-metadata.ts', () => ({
  updateAgentTaskMetadata: vi.fn().mockResolvedValue({ changed: true }),
}));

/** Authority runs unchanged inside a real serializable-wrapper callback;
 * this fake only supplies SQL rows, and the last domain write is inert. */
function fixture(
  options: {
    ownerType?: string;
    missingAgent?: boolean;
    missingProject?: boolean;
    ended?: boolean;
    runAgent?: string;
    runProject?: string;
    memberWorkspace?: boolean;
    role?: string | null;
    starter?: string;
    revokedSchedule?: boolean;
  } = {},
) {
  let inTransaction = false;
  const reads: { text: string; values: unknown[]; inTransaction: boolean }[] =
    [];
  const sessionId = options.memberWorkspace
    ? 'pa-manager-member'
    : 'pa-manager';
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    reads.push({ text, values, inTransaction });
    if (text.includes('FROM app.sandbox_sessions'))
      return [
        { ownerType: options.ownerType ?? 'project_agent', ownerId: 'manager' },
      ];
    if (text.includes('FROM app.project_agents'))
      return options.missingAgent
        ? []
        : [{ id: 'manager', projectId: 'project' }];
    if (text.includes('FROM app.projects'))
      return options.missingProject ? [] : [{ id: 'project', teamIds: [] }];
    if (text.includes('FROM app.project_agent_runs'))
      return options.ended
        ? []
        : [
            {
              taskId: 'issuer-task',
              projectId: options.runProject ?? 'project',
              agentId: options.runAgent ?? 'manager',
              sessionId,
              startedBy: options.starter ?? 'user:editor',
            },
          ];
    if (text.includes('FROM app.automation_triggers'))
      return options.revokedSchedule ? [] : [{ id: 'schedule' }];
    if (text.includes('FROM "member"'))
      return options.role === null
        ? []
        : [
            {
              id: 'membership',
              organizationId: 'org',
              userId: 'editor',
              role: options.role ?? 'editor',
            },
          ];
    return [];
  };
  const tx = Object.assign(tag, { unsafe: (text: string) => text });
  const runner = {
    begin: async (
      _isolation: string,
      body: (value: unknown) => Promise<unknown>,
    ) => {
      inTransaction = true;
      try {
        return await body(tx);
      } finally {
        inTransaction = false;
      }
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the handler uses only this serializable begin stand-in
  const handler = sandboxToolShimHandlers(runner as unknown as Sql)[
    'tasks/internal_mutations:agentUpdateTaskMetadata'
  ];
  if (handler === undefined) throw new Error('Missing metadata handler');
  const patch = {
    taskId: 'idle-target',
    priority: 'p1',
    expected: { priority: null },
  };
  return {
    reads,
    tx,
    patch,
    call: (exec: string | undefined = 'issuer-exec') =>
      handler({
        organizationId: 'org',
        sessionId,
        ...(exec === undefined ? {} : { taskRunExecId: exec }),
        patch,
      }),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('metadata session authority', () => {
  it('a live manager acts on a different idle task with token-derived identity inside the transaction', async () => {
    const f = fixture();
    expect(await f.call()).toEqual({ changed: true });
    expect(updateAgentTaskMetadata).toHaveBeenCalledWith(f.tx, {
      organizationId: 'org',
      projectId: 'project',
      actorId: 'manager',
      patch: f.patch,
    });
    expect(f.reads.length).toBeGreaterThan(4);
    expect(f.reads.every((row) => row.inTransaction)).toBe(true);
    expect(
      f.reads.find((row) => row.text.includes('FROM app.project_agent_runs'))
        ?.values,
    ).toEqual(['org', 'pa-manager', 'issuer-exec']);
  });

  it('accepts a live enabled project-bound schedule through the existing authority rule', async () => {
    expect(await fixture({ starter: 'trigger:schedule' }).call()).toEqual({
      changed: true,
    });
  });

  it.each([
    { ownerType: 'workflow_run' },
    { ownerType: 'user' },
    { missingAgent: true },
    { missingProject: true },
    { ended: true },
    { runAgent: 'other-agent' },
    { runProject: 'other-project' },
    { memberWorkspace: true },
    { role: 'member' },
    { role: 'disabled' },
    { role: null },
    { starter: 'trigger:schedule', revokedSchedule: true },
  ])(
    'refuses lost or foreign run authority without reaching any target write (%j)',
    async (options) => {
      await expect(fixture(options).call()).rejects.toMatchObject({
        data: { code: 'TASK_METADATA_FORBIDDEN' },
      });
      expect(updateAgentTaskMetadata).not.toHaveBeenCalled();
    },
  );

  it('requires a run even for the legacy standing workspace', async () => {
    const f = fixture();
    // Default parameters deliberately do not fill an omitted token field.
    const handler = sandboxToolShimHandlers({
      begin: async (
        _isolation: string,
        body: (tx: unknown) => Promise<unknown>,
      ) => body(f.tx),
    } as unknown as Sql)['tasks/internal_mutations:agentUpdateTaskMetadata'];
    await expect(
      handler?.({
        organizationId: 'org',
        sessionId: 'pa-manager',
        patch: f.patch,
      }),
    ).rejects.toMatchObject({ data: { code: 'TASK_METADATA_FORBIDDEN' } });
    expect(updateAgentTaskMetadata).not.toHaveBeenCalled();
  });
});
