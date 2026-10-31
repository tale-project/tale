// @vitest-environment node

/**
 * The runs a trigger started, as the trigger panel lists them under a
 * webhook's recent deliveries: newest first, each with the lane the webhook
 * door recognised its delivery by while the ledger row lives. The store's
 * own `listTriggerRuns` runs here against a scripted `sql`, so the select
 * is under test too; the real-Postgres lane
 * (`checkAutomationTriggerDelivery` in `integration-check.ts`) reads real
 * deliveries back and checks the plan.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import type { ProjectAuthContext } from '../projects/service.ts';
import { listTriggerRuns, TRIGGER_RUNS_MAX } from './store.ts';

interface Statement {
  text: string;
  values: unknown[];
}

const FRAGMENT = Symbol('fragment');
interface Fragment extends Statement {
  [FRAGMENT]: true;
}

function isFragment(value: unknown): value is Fragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [FRAGMENT]?: true })[FRAGMENT] === true
  );
}

/** A scripted `sql` that inlines nested fragments the way postgres.js
 *  does, so a recorded statement is the one Postgres would see; every
 *  statement answers `rows`. */
function scripted(rows: Record<string, unknown>[]): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
    const flat: unknown[] = [];
    strings.forEach((part, index) => {
      text += part;
      if (index >= values.length) return;
      const value = values[index];
      if (isFragment(value)) {
        text += value.text;
        flat.push(...value.values);
      } else {
        text += '?';
        flat.push(value);
      }
    });
    text = text.replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values: flat });
    const fragment: Fragment = { [FRAGMENT]: true, text, values: flat };
    return Object.assign(Promise.resolve(rows), fragment);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a scripted tagged template standing in for postgres.js
  return { sql: tag as unknown as Sql, statements };
}

/** The trigger-runs reads among the recorded statements, without the
 *  fragments they were built from. */
function reads(statements: Statement[]): Statement[] {
  return statements.filter(({ text }) => text.startsWith('WITH started'));
}

/** The project audience: its teams, with the legacy pair's fallback. */
const TEAMS =
  'CASE WHEN cardinality(team_ids) > 0 THEN team_ids ELSE array_remove(ARRAY[team_id] || shared_with_team_ids, NULL) END';
/** The projects the reader may read (`readableProjectsSql`), inlined. */
const RELATION = `( SELECT id AS project_id, key AS project_key, archived_at_ms AS project_archived_at_ms FROM app.projects WHERE org_id = ? AND ? AND (? OR archived_at_ms IS NULL) AND (? OR cardinality(${TEAMS}) = 0 OR ${TEAMS} && ?::text[]) )`;
const READABLE_RUNS = `AND (r.project_id IS NULL OR r.project_id IN ( SELECT rp.project_id FROM ${RELATION} rp))`;

const owner: ProjectAuthContext = {
  organizationId: 'org_1',
  userId: 'user_ada',
  role: 'owner',
  teamIds: [],
};
const member: ProjectAuthContext = {
  organizationId: 'org_1',
  userId: 'user_mia',
  role: 'member',
  teamIds: ['team_finance'],
};

describe('listTriggerRuns', () => {
  it('names the delivery lane of each webhook run: Ada sees which header GitHub sent', async () => {
    const { sql } = scripted([
      {
        runId: 'run_3',
        startedAt: 3_000,
        status: 'running',
        source: 'header:x-github-delivery',
      },
      { runId: 'run_2', startedAt: 2_000, status: 'success', source: 'body' },
      // The ledger row is gone: the delivery's identity expired.
      { runId: 'run_1', startedAt: 1_000, status: 'failed', source: null },
    ]);
    expect(
      await listTriggerRuns(sql, 'org_1', { name: 'billing/github-sync' }),
    ).toEqual([
      {
        runId: 'run_3',
        startedAt: 3_000,
        status: 'running',
        deliverySource: 'header',
        header: 'x-github-delivery',
      },
      {
        runId: 'run_2',
        startedAt: 2_000,
        status: 'success',
        deliverySource: 'body',
        header: null,
      },
      {
        runId: 'run_1',
        startedAt: 1_000,
        status: 'failed',
        deliverySource: null,
        header: null,
      },
    ]);
  });

  it('reads only the runs the bound trigger started, newest first, and ten by default', async () => {
    const { sql, statements } = scripted([]);
    await listTriggerRuns(sql, 'org_1', { name: 'ops/nightly' });
    const [select] = reads(statements);
    expect(select?.text).toContain("r.started_by = 'trigger:' || t.id");
    expect(select?.text).toContain('ORDER BY r.started_at_ms DESC, r.id DESC');
    expect(select?.text).toContain('d.expires_at_ms >= s.started_at_ms');
    expect(select?.values).toEqual(
      expect.arrayContaining(['org_1', 'ops/nightly', 10]),
    );
  });

  it('holds the limit between 1 and the cap', async () => {
    const { sql, statements } = scripted([]);
    await listTriggerRuns(sql, 'org_1', { name: 'ops/nightly', limit: 500 });
    await listTriggerRuns(sql, 'org_1', { name: 'ops/nightly', limit: 0 });
    const [capped, floored] = reads(statements);
    expect(capped?.values).toContain(TRIGGER_RUNS_MAX);
    expect(floored?.values).toContain(1);
  });

  // The reader's projects join the read (#5201): a run of an organization
  // scope, or of a project the reader may read, archived or not; never the
  // reader's project ids sent back as a list.
  it('reads an owner’s runs of every project of the organization [PROJ-R1]', async () => {
    const { sql, statements } = scripted([]);
    await listTriggerRuns(sql, 'org_1', { name: 'ops/nightly', viewer: owner });
    const [select] = reads(statements);
    expect(select?.text).toContain(READABLE_RUNS);
    expect(select?.text).not.toContain('ANY(');
    // Org · not a disabled seat · archived projects kept · admin · teams.
    expect(select?.values).toEqual([
      'org_1',
      'ops/nightly',
      'org_1',
      true,
      true,
      true,
      [],
      10,
    ]);
  });

  it('reads a member’s runs of projects open to the organization or shared with a team of theirs [PROJ-R2]', async () => {
    const { sql, statements } = scripted([]);
    await listTriggerRuns(sql, 'org_1', {
      name: 'ops/nightly',
      viewer: member,
    });
    const [select] = reads(statements);
    expect(select?.text).toContain(READABLE_RUNS);
    expect(select?.values).toEqual([
      'org_1',
      'ops/nightly',
      'org_1',
      true,
      true,
      false,
      ['team_finance'],
      10,
    ]);
  });

  it('gives a disabled seat no run of a project, only those of the organization [PROJ-R2]', async () => {
    const { sql, statements } = scripted([]);
    await listTriggerRuns(sql, 'org_1', {
      name: 'ops/nightly',
      viewer: { ...member, role: 'disabled' },
    });
    const [select] = reads(statements);
    expect(select?.text).toContain(READABLE_RUNS);
    expect(select?.values.slice(2, 4)).toEqual(['org_1', false]);
  });

  it('reads every run the trigger started when no reader is named', async () => {
    const { sql, statements } = scripted([]);
    await listTriggerRuns(sql, 'org_1', { name: 'ops/nightly' });
    const [select] = reads(statements);
    expect(select?.text).not.toContain('r.project_id');
    expect(select?.text).not.toContain('app.projects');
  });
});
