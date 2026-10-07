/**
 * The billing subject of a sandbox op: a person by bare user id behind every
 * `user:`/`api-key:`/bare starter, the automation sentinel behind a trigger
 * (a workflow turn's, or a project agent's run a schedule began),
 * the key beside a keyed start, the agent's ID (not its name) for a project
 * agent — and the op row's own stamp when the run row is gone. The SQL is
 * scripted; the parser is the real one.
 */

import { describe, expect, it } from 'vitest';

import { AUTOMATION_SUBJECT_ID } from '../../../lib/shared/constants/usage.ts';
import {
  resolveSessionOpAttribution,
  splitModelRef,
} from './op-attribution.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(answers: Array<{ match: string; rows: unknown[] }>) {
  const statements: Statement[] = [];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    const hit = answers.find((answer) => text.includes(answer.match));
    return Promise.resolve(hit?.rows ?? []);
  };
  return { sql: run as never, statements };
}

const TASK_OP = {
  organizationId: 'org-1',
  sessionId: 'pa-1',
  execId: 'exec-1',
  kind: 'task-agent',
};
const WORKFLOW_OP = { ...TASK_OP, sessionId: 'wf-1', kind: 'workflow-agent' };

describe('resolveSessionOpAttribution — task-agent', () => {
  it('books the person who kicked the run under the agent’s id [SBX-R14]', async () => {
    const { sql, statements } = fakeSql([
      {
        match: 'FROM app.project_agent_runs r',
        rows: [{ startedBy: 'user-1', agentId: 'agent-1' }],
      },
    ]);
    await expect(resolveSessionOpAttribution(sql, TASK_OP)).resolves.toEqual({
      userId: 'user-1',
      agentSlug: 'agent-1',
    });
    // The run row answers; the op stamp is never consulted.
    expect(
      statements.some((s) => s.text.includes('FROM app.sandbox_session_ops')),
    ).toBe(false);
  });

  it('falls back to the op row’s stamp when the run row is gone', async () => {
    const { sql } = fakeSql([
      {
        match: 'FROM app.sandbox_session_ops',
        rows: [{ userId: 'user-9', agentSlug: 'agent-9', apiKeyId: null }],
      },
    ]);
    await expect(resolveSessionOpAttribution(sql, TASK_OP)).resolves.toEqual({
      userId: 'user-9',
      agentSlug: 'agent-9',
    });
  });

  it('books a run a schedule began under the automation sentinel, under the agent’s id [SBX-R14]', async () => {
    const { sql, statements } = fakeSql([
      {
        match: 'FROM app.project_agent_runs r',
        rows: [{ startedBy: 'trigger:schedule-1', agentId: 'agent-1' }],
      },
    ]);
    await expect(resolveSessionOpAttribution(sql, TASK_OP)).resolves.toEqual({
      userId: AUTOMATION_SUBJECT_ID,
      agentSlug: 'agent-1',
    });
    // Answered from the run row: a stale op stamp never names a person.
    expect(
      statements.some((s) => s.text.includes('FROM app.sandbox_session_ops')),
    ).toBe(false);
  });

  it('answers null when neither the run nor the stamp names anyone', async () => {
    const { sql } = fakeSql([
      {
        match: 'FROM app.sandbox_session_ops',
        rows: [{ userId: null, agentSlug: null, apiKeyId: null }],
      },
    ]);
    await expect(resolveSessionOpAttribution(sql, TASK_OP)).resolves.toBeNull();
  });
});

describe('resolveSessionOpAttribution — workflow-agent', () => {
  const run = (startedBy: string, apiKeyId: string | null = null) => ({
    match: 'JOIN app.automation_runs ar',
    rows: [{ startedBy, name: 'invoices/monthly', apiKeyId }],
  });

  it('derives the person from a `user:` starter, never the door string [SBX-R14]', async () => {
    const { sql } = fakeSql([run('user:user-2')]);
    await expect(
      resolveSessionOpAttribution(sql, WORKFLOW_OP),
    ).resolves.toEqual({ userId: 'user-2', agentSlug: 'invoices/monthly' });
  });

  it('books a keyed start to the person AND the key [SBX-R14]', async () => {
    const { sql } = fakeSql([run('api-key:user-3', 'key-1')]);
    await expect(
      resolveSessionOpAttribution(sql, WORKFLOW_OP),
    ).resolves.toEqual({
      userId: 'user-3',
      agentSlug: 'invoices/monthly',
      apiKeyId: 'key-1',
    });
  });

  it('leaves the key out when a keyed run predates the column', async () => {
    const { sql } = fakeSql([run('api-key:user-3')]);
    await expect(
      resolveSessionOpAttribution(sql, WORKFLOW_OP),
    ).resolves.toEqual({ userId: 'user-3', agentSlug: 'invoices/monthly' });
  });

  it('books a trigger-started run under the automation sentinel [SBX-R14]', async () => {
    const { sql } = fakeSql([run('trigger:t-1')]);
    await expect(
      resolveSessionOpAttribution(sql, WORKFLOW_OP),
    ).resolves.toEqual({
      userId: AUTOMATION_SUBJECT_ID,
      agentSlug: 'invoices/monthly',
    });
  });

  it('reads a pre-prefix bare starter as the person', async () => {
    const { sql } = fakeSql([run('user-4')]);
    await expect(
      resolveSessionOpAttribution(sql, WORKFLOW_OP),
    ).resolves.toMatchObject({ userId: 'user-4' });
  });

  it('falls through to the op stamp for a starter it cannot read', async () => {
    const { sql } = fakeSql([
      run('system:automation'),
      {
        match: 'FROM app.sandbox_session_ops',
        rows: [{ userId: 'user-5', agentSlug: 'x', apiKeyId: 'key-2' }],
      },
    ]);
    await expect(
      resolveSessionOpAttribution(sql, WORKFLOW_OP),
    ).resolves.toEqual({ userId: 'user-5', agentSlug: 'x', apiKeyId: 'key-2' });
  });
});

describe('resolveSessionOpAttribution — the project the work is in [GOV-R14]', () => {
  it('names the project an agent’s run is in, a schedule’s run included', async () => {
    for (const startedBy of ['user-1', 'trigger:schedule-1']) {
      const { sql } = fakeSql([
        {
          match: 'FROM app.project_agent_runs r',
          rows: [{ startedBy, agentId: 'agent-1', projectId: 'project-1' }],
        },
      ]);
      await expect(
        resolveSessionOpAttribution(sql, TASK_OP),
      ).resolves.toMatchObject({ projectId: 'project-1' });
    }
  });

  it('names the project an automation run is in, whoever started it', async () => {
    for (const startedBy of ['user:user-2', 'api-key:user-3', 'trigger:t-1']) {
      const { sql } = fakeSql([
        {
          match: 'JOIN app.automation_runs ar',
          rows: [
            {
              startedBy,
              name: 'invoices/monthly',
              apiKeyId: null,
              projectId: 'project-1',
            },
          ],
        },
      ]);
      await expect(
        resolveSessionOpAttribution(sql, WORKFLOW_OP),
      ).resolves.toMatchObject({ projectId: 'project-1' });
    }
  });

  it('names none for a run outside a project, and reads the stamp’s once the run is gone', async () => {
    const outside = fakeSql([
      {
        match: 'JOIN app.automation_runs ar',
        rows: [
          {
            startedBy: 'user:user-2',
            name: 'invoices/monthly',
            apiKeyId: null,
            projectId: null,
          },
        ],
      },
    ]);
    await expect(
      resolveSessionOpAttribution(outside.sql, WORKFLOW_OP),
    ).resolves.not.toHaveProperty('projectId');
    const stamped = fakeSql([
      {
        match: 'FROM app.sandbox_session_ops',
        rows: [
          {
            userId: 'identity-1',
            agentSlug: '__direct_api__',
            apiKeyId: 'key-1',
            projectId: 'project-1',
          },
        ],
      },
    ]);
    await expect(
      resolveSessionOpAttribution(stamped.sql, {
        ...TASK_OP,
        kind: 'model-api',
      }),
    ).resolves.toEqual({
      userId: 'identity-1',
      agentSlug: '__direct_api__',
      apiKeyId: 'key-1',
      projectId: 'project-1',
    });
  });
});

describe('splitModelRef', () => {
  it('splits the connector slug from the catalog id behind the gateway provider', () => {
    expect(splitModelRef('openai/openai/gpt-5')).toEqual({
      provider: 'openai',
      model: 'gpt-5',
    });
    expect(splitModelRef('deepseek/deepseek-v4')).toEqual({
      provider: 'deepseek',
      model: 'deepseek-v4',
    });
    expect(splitModelRef('nope')).toBeNull();
  });
});
