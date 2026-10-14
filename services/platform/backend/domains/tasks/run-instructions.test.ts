import { createHash } from 'node:crypto';

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import {
  instructionsDigest,
  projectInstructionsBlock,
  RunInstructionsUnavailableError,
  snapshotRunInstructions,
} from './run-instructions.ts';

const sha = (text: string) =>
  createHash('sha256').update(text, 'utf8').digest('hex');

/** A database holding one task of a project, and the statements run on it. */
function databaseWith(
  row: {
    projectName: string;
    projectKey: string | null;
    projectInstructions: string | null;
    description: string | null;
  } | null,
) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const query = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (text.includes('FROM app.tasks t')) {
      return Promise.resolve(row === null ? [] : [row]);
    }
    return Promise.resolve([]);
  };
  const sql = Object.assign(query, {
    json: (value: unknown) => ({ json: value }),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the snapshot uses only the tagged template and json; the fake models both
  return { sql: sql as unknown as Sql, statements };
}

describe('every task turn opens with its project’s current instructions, and its run records what it was handed [TASK-R49]', () => {
  it('digests the exact text it hands over, and none for a blank one', () => {
    expect(instructionsDigest('Ship small, reviewed changes.')).toBe(
      sha('Ship small, reviewed changes.'),
    );
    expect(instructionsDigest('  ')).toBeNull();
    expect(instructionsDigest(null)).toBeNull();
    expect(instructionsDigest(undefined)).toBeNull();
  });

  it('frames the project’s instructions with its name and key, and has no block for none', () => {
    const block = projectInstructionsBlock({
      name: 'Tale',
      key: 'TALE',
      instructions: 'Ship small, reviewed changes.',
    });
    expect(block).toContain('Instructions for project "Tale (TALE)"');
    expect(block).toContain('replace any earlier copy of them');
    expect(block?.endsWith('Ship small, reviewed changes.')).toBe(true);
    expect(
      projectInstructionsBlock({ name: 'Tale', key: null, instructions: '' }),
    ).toBeNull();
  });

  it('records the digests of the project’s, the agent’s and the task’s texts on the run, fenced on its execution', async () => {
    const { sql, statements } = databaseWith({
      projectName: 'Tale',
      projectKey: null,
      projectInstructions: 'Ship small, reviewed changes.',
      description: 'Write the release notes.',
    });
    const answer = await snapshotRunInstructions(sql, {
      organizationId: 'org-1',
      runId: 'run-1',
      taskId: 'task-1',
      execId: 'exec-2',
      agentInstructions: 'You write release notes.',
      now: 1_000,
    });
    expect(answer.projectBlock).toContain('Ship small, reviewed changes.');
    expect(answer.snapshot).toEqual({
      project: sha('Ship small, reviewed changes.'),
      agent: sha('You write release notes.'),
      task: sha('Write the release notes.'),
      execId: 'exec-2',
      takenAt: 1_000,
    });
    const update = statements.find((statement) =>
      statement.text.includes('UPDATE app.project_agent_runs'),
    );
    expect(update?.text).toContain('exec_id = ?');
    expect(update?.values).toEqual([
      { json: answer.snapshot },
      'run-1',
      'org-1',
      'exec-2',
    ]);
  });

  it('refuses a turn whose task or project cannot be read', async () => {
    const { sql, statements } = databaseWith(null);
    await expect(
      snapshotRunInstructions(sql, {
        organizationId: 'org-1',
        runId: 'run-1',
        taskId: 'task-gone',
        execId: 'exec-1',
        agentInstructions: null,
      }),
    ).rejects.toBeInstanceOf(RunInstructionsUnavailableError);
    expect(
      statements.some((statement) => statement.text.includes('UPDATE')),
    ).toBe(false);
  });
});
