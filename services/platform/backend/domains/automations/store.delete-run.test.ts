// @vitest-environment node

/**
 * `deleteRunInTx` — a FINISHED run goes with the ledger rows that would
 * otherwise answer a redelivery or a key replay with a run that is gone,
 * audited and hinted; a run still in flight is refused (the stepper needs
 * its row); a run that is not there answers `deleted: false`. The delete
 * clears the trigger that names the run (`ON DELETE SET NULL`), so the
 * organization's audit chain is taken between the run's own row and that
 * delete — the order a landing run takes them in (`trigger-failures.ts`).
 */

import { RETRY_QUEUE_LOCK_CLASS } from '@tale/shared/db/serializable';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../audit_logs/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../audit_logs/service.ts')>()),
  createAuditLog: vi.fn(),
}));

import { emitHintInTx } from '../../realtime/outbox.ts';
import { auditChainQueueKey, createAuditLog } from '../audit_logs/service.ts';
import { automationTombstone, deleteRunInTx } from './store.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function fakeRun(row: { status: string } | null) {
  const statements: Statement[] = [];
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (
      text.includes('FROM app.automation_runs') &&
      text.includes('FOR UPDATE')
    ) {
      return row === null
        ? []
        : [{ name: 'orders/process', version: 2, mode: 'live', ...row }];
    }
    return [];
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) => text,
    json: (value: unknown) => value,
  }) as unknown as Sql;
  return { tx: sql as never, statements };
}

const args = { organizationId: 'org-1', runId: 'run-1', actor: 'user-1' };

beforeEach(() => vi.clearAllMocks());

describe('deleteRunInTx', () => {
  it.each(['success', 'failed', 'cancelled'])(
    'removes a %s run with its ledger entries, audited and hinted',
    async (status) => {
      const { tx, statements } = fakeRun({ status });
      await expect(deleteRunInTx(tx, args)).resolves.toEqual({ deleted: true });
      const deletes = statements
        .filter((s) => s.text.startsWith('DELETE FROM'))
        .map((s) => s.text.split(' WHERE')[0]);
      expect(deletes).toEqual([
        'DELETE FROM app.automation_webhook_deliveries',
        'DELETE FROM app.automation_run_idempotency',
        'DELETE FROM app.automation_runs',
      ]);
      expect(createAuditLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          organizationId: 'org-1',
          actorId: 'user-1',
          action: 'automation.run.deleted',
          resourceType: 'automation_run',
          resourceId: 'run-1',
          resourceName: 'orders/process@2',
          metadata: { mode: 'live', runStatus: status },
        }),
      );
      expect(emitHintInTx).toHaveBeenCalledWith(expect.anything(), {
        orgId: 'org-1',
        entity: 'automation_run',
        entityId: 'run-1',
      });
    },
  );

  it('takes the audit chain after the run’s own row and before the delete that clears its trigger', async () => {
    const { tx, statements } = fakeRun({ status: 'failed' });
    vi.mocked(createAuditLog).mockImplementationOnce(async () => {
      statements.push({ text: 'createAuditLog', values: [] });
      return 'audit-1';
    });
    await deleteRunInTx(tx, args);
    const at = (predicate: (text: string) => boolean) =>
      statements.findIndex((s) => predicate(s.text));
    const runRow = at(
      (text) =>
        text.includes('FROM app.automation_runs') &&
        text.includes('FOR UPDATE'),
    );
    const chain = at((text) => text.includes('pg_advisory_xact_lock'));
    const firstDelete = at((text) => text.startsWith('DELETE FROM'));
    const runDelete = at((text) =>
      text.startsWith('DELETE FROM app.automation_runs'),
    );
    const audit = at((text) => text === 'createAuditLog');
    expect(statements[chain]?.values).toEqual([
      RETRY_QUEUE_LOCK_CLASS,
      auditChainQueueKey('org-1'),
    ]);
    expect(runRow).toBeGreaterThan(-1);
    expect(chain).toBeGreaterThan(runRow);
    expect(firstDelete).toBeGreaterThan(chain);
    expect(runDelete).toBeGreaterThan(chain);
    expect(audit).toBeGreaterThan(runDelete);
  });

  it.each(['queued', 'running', 'waiting'])(
    'refuses a %s run and deletes nothing',
    async (status) => {
      const { tx, statements } = fakeRun({ status });
      await expect(deleteRunInTx(tx, args)).rejects.toMatchObject({
        code: 'RUN_ACTIVE',
        status: 409,
      });
      expect(statements.some((s) => s.text.startsWith('DELETE FROM'))).toBe(
        false,
      );
      expect(
        statements.some((s) => s.text.includes('pg_advisory_xact_lock')),
      ).toBe(false);
      expect(createAuditLog).not.toHaveBeenCalled();
    },
  );

  it('answers deleted: false for a run that is not there', async () => {
    const { tx, statements } = fakeRun(null);
    await expect(deleteRunInTx(tx, args)).resolves.toEqual({ deleted: false });
    expect(statements.some((s) => s.text.startsWith('DELETE FROM'))).toBe(
      false,
    );
  });
});

/** The tombstone read a deleted automation's run page depends on. */
describe('automationTombstone', () => {
  function fakeTombstones(rows: unknown[]) {
    const statements: Statement[] = [];
    const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      statements.push({
        text: strings.join('?').replace(/\s+/g, ' ').trim(),
        values,
      });
      return rows;
    };
    return { sql: tag as unknown as Sql, statements };
  }

  it('answers the deletion date and actor of a deleted name', async () => {
    const { sql, statements } = fakeTombstones([
      { deletedAt: 1789363170729, deletedBy: 'user-1' },
    ]);
    await expect(
      automationTombstone(sql, 'org-1', 'orders/process'),
    ).resolves.toEqual({ deletedAt: 1789363170729, deletedBy: 'user-1' });
    expect(statements[0]?.text).toContain('FROM app.automation_tombstones');
    expect(statements[0]?.values).toEqual(['org-1', 'orders/process']);
  });

  it('answers null for a name nobody deleted', async () => {
    const { sql } = fakeTombstones([]);
    await expect(
      automationTombstone(sql, 'org-1', 'orders/process'),
    ).resolves.toBeNull();
  });
});
