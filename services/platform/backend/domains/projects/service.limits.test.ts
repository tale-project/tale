// @vitest-environment node

/**
 * The service validates against the SHARED project constants. It once
 * carried a private `PROJECT_INSTRUCTIONS_MAX_CHARS = 6000` while the editor
 * counted (and promised) the shared 20 000: typing 6 001–20 000 characters
 * showed a green counter, an enabled Save, and a 400 naming a cap the editor
 * never displayed. This pins the refusal threshold to the shared constant.
 */

import type { TransactionSql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PROJECT_INSTRUCTIONS_MAX_CHARS } from '../../../lib/shared/schemas/projects.ts';
import { ProjectError, updateProjectInstructions } from './service.ts';

vi.mock('../audit_logs/service.ts', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../events/emit.ts', () => ({ emitEvent: vi.fn() }));
vi.mock('../documents/service.ts', () => ({
  recordTrashRefusalFromJson: () => null,
}));
vi.mock('../tasks/retire.ts', () => ({ retireTasksInTx: vi.fn() }));

const PROJECT = {
  id: 'project-1',
  organizationId: 'org_1',
  name: 'Q2 Sales',
  teamId: null,
  sharedWithTeamIds: [] as string[],
  instructions: null,
  createdBy: 'user-1',
};

const auth = {
  organizationId: 'org_1',
  userId: 'user-1',
  role: 'admin',
  teamIds: [] as string[],
};

function fakeTx(): { tx: TransactionSql; writes: string[] } {
  const writes: string[] = [];
  const run = (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    if (text.includes('FROM app.projects WHERE id = ?')) {
      return Promise.resolve([PROJECT]);
    }
    if (/^(UPDATE|INSERT|DELETE)/.test(text)) writes.push(text);
    return Promise.resolve([]);
  };
  const tx = Object.assign(run, { unsafe: (text: string) => text });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for the postgres.js transaction
  return { tx: tx as unknown as TransactionSql, writes };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('updateProjectInstructions — the shared cap is the cap', () => {
  it('accepts exactly the shared maximum', async () => {
    const { tx, writes } = fakeTx();
    await updateProjectInstructions(
      tx,
      auth,
      'project-1',
      'a'.repeat(PROJECT_INSTRUCTIONS_MAX_CHARS),
    );
    expect(writes.some((w) => w.startsWith('UPDATE app.projects'))).toBe(true);
  });

  it('refuses one past the shared maximum, naming that cap', async () => {
    const { tx, writes } = fakeTx();
    const attempt = updateProjectInstructions(
      tx,
      auth,
      'project-1',
      'a'.repeat(PROJECT_INSTRUCTIONS_MAX_CHARS + 1),
    );
    await expect(attempt).rejects.toBeInstanceOf(ProjectError);
    await expect(attempt).rejects.toMatchObject({
      code: 'PROJECT_INSTRUCTIONS_TOO_LONG',
      data: { cap: PROJECT_INSTRUCTIONS_MAX_CHARS },
    });
    expect(writes).toEqual([]);
  });
});
