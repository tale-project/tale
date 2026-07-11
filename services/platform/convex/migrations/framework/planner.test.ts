import { describe, expect, it } from 'vitest';

import {
  appliedFrontier,
  computePendingUp,
  computeRollback,
  foldLedgerAliases,
  indexLedger,
  orderMigrations,
  restrictToOnly,
  type LedgerState,
} from './planner';
import type { MigrationMeta } from './types';

function meta(
  semver: string,
  numericId: number,
  over: Partial<MigrationMeta> = {},
): MigrationMeta {
  return {
    id: `${semver}/${String(numericId).padStart(2, '0')}_m`,
    semver,
    numericId,
    slug: 'm',
    title: 'm',
    description: 'm',
    kind: 'db',
    reversible: true,
    destructive: false,
    snapshot: 'none',
    ...over,
  };
}

const A = meta('0.2.14', 1);
const B = meta('0.2.85', 1);
const C = meta('0.2.85', 2, { destructive: true });
const REF = meta('0.2.1', 1, { kind: 'reference' });
const ALL = [C, REF, B, A]; // intentionally unsorted

function applied(...ids: string[]): LedgerState[] {
  return ids.map((id) => ({
    migrationId: id,
    direction: 'up',
    status: 'applied',
  }));
}

describe('orderMigrations', () => {
  it('sorts by (semver, numericId) regardless of input order', () => {
    expect(orderMigrations(ALL).map((s) => s.meta.id)).toEqual([
      REF.id,
      A.id,
      B.id,
      C.id,
    ]);
  });
});

describe('computePendingUp', () => {
  it('excludes reference migrations and applied migrations', () => {
    expect(computePendingUp(ALL, []).map((s) => s.meta.id)).toEqual([
      A.id,
      B.id,
      C.id,
    ]);
    expect(computePendingUp(ALL, applied(A.id)).map((s) => s.meta.id)).toEqual([
      B.id,
      C.id,
    ]);
  });

  it('honors the inclusive `to` semver bound', () => {
    expect(computePendingUp(ALL, [], '0.2.85').map((s) => s.meta.id)).toEqual([
      A.id,
      B.id,
      C.id,
    ]);
    expect(computePendingUp(ALL, [], '0.2.14').map((s) => s.meta.id)).toEqual([
      A.id,
    ]);
  });
});

describe('computeRollback', () => {
  it('returns applied migrations above `to`, newest first', () => {
    const ledger = applied(A.id, B.id, C.id);
    expect(
      computeRollback(ALL, ledger, '0.2.14').map((s) => s.meta.id),
    ).toEqual([C.id, B.id]);
    expect(computeRollback(ALL, ledger, '0.2.85')).toEqual([]);
  });
});

describe('appliedFrontier', () => {
  it('is the highest applied orderKey', () => {
    const steps = orderMigrations(ALL);
    expect(
      appliedFrontier(steps, indexLedger(applied(A.id, B.id)))?.meta.id,
    ).toBe(B.id);
    expect(appliedFrontier(steps, indexLedger([]))).toBeNull();
  });
});

describe('restrictToOnly', () => {
  it('keeps only the listed ids in order', () => {
    const steps = orderMigrations(ALL);
    expect(restrictToOnly(steps, [C.id, A.id]).map((s) => s.meta.id)).toEqual([
      A.id,
      C.id,
    ]);
  });
});

describe('foldLedgerAliases', () => {
  const RENAMED = meta('0.3.4', 6, { formerIds: ['0.2.90/06_m'] });
  const OLD_ROW: LedgerState = {
    migrationId: '0.2.90/06_m',
    direction: 'up',
    status: 'applied',
  };

  it('re-keys a former-id row to the current id', () => {
    const folded = foldLedgerAliases([OLD_ROW], [RENAMED]);
    expect(folded).toEqual([
      { migrationId: RENAMED.id, direction: 'up', status: 'applied' },
    ]);
  });

  it('a row under the current id shadows the former-id row', () => {
    const current: LedgerState = {
      migrationId: RENAMED.id,
      direction: 'down',
      status: 'rolledBack',
    };
    const folded = foldLedgerAliases([OLD_ROW, current], [RENAMED]);
    expect(folded).toEqual([OLD_ROW, current]);
  });

  it('is a passthrough when no meta declares formerIds', () => {
    const rows = [OLD_ROW];
    expect(foldLedgerAliases(rows, [A, B])).toEqual(rows);
  });
});
