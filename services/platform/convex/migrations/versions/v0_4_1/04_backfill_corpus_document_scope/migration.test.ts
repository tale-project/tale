// @vitest-environment node

import type { Sql } from 'postgres';
import { afterAll, expect } from 'vitest';

import {
  closeKnowledgePools,
  setPoolFactory,
} from '../../../../knowledge/pool';
import { buildModules } from '../../../framework/test_helpers';
import { defineMigrationTest } from '../../../testing/harness.testkit';

const DIR = 'migrations/versions/v0_4_1/04_backfill_corpus_document_scope';

/**
 * The corpus is an EXTERNAL PostgreSQL database, so the world cannot carry
 * it; the migration is tested through the same `setPoolFactory` seam the
 * knowledge suites use (`knowledge/fetch.test.ts`): a recorder pool captures
 * every statement the handlers issue, and the assertions read the SQL +
 * parameters — proving each stamp the way `corpus.test.ts` proves scoping.
 */
interface Recorded {
  readonly text: string;
  readonly params: readonly unknown[];
}

const recorded: Recorded[] = [];

function recorderPool(): Sql {
  const sql = (() => Promise.resolve([])) as unknown as Sql & {
    unsafe: unknown;
    end: unknown;
  };
  sql.unsafe = ((text: string, params: unknown[] = []) => {
    recorded.push({ text, params });
    return Promise.resolve([]);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- postgres.js types `unsafe` as a rich PendingQuery; the handlers only await it
  }) as unknown as Sql['unsafe'];
  // `closeKnowledgePools` ends every cached pool between worlds.
  sql.end = () => Promise.resolve();
  return sql as Sql;
}

/** A pool whose every statement fails like an unreachable database. */
function unreachablePool(): Sql {
  const sql = (() => Promise.resolve([])) as unknown as Sql & {
    unsafe: unknown;
    end: unknown;
  };
  sql.unsafe = (() =>
    Promise.reject(
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
        code: 'ECONNREFUSED',
      }),
    )) as unknown as Sql['unsafe'];
  sql.end = () => Promise.resolve();
  return sql as Sql;
}

/** Fresh recorder per world: pools are cached by URL, so the previous
 * world's fake must be dropped or its statements would bleed forward. */
async function armRecorder(): Promise<void> {
  await closeKnowledgePools();
  recorded.length = 0;
  setPoolFactory(recorderPool);
}

async function armUnreachable(): Promise<void> {
  await closeKnowledgePools();
  recorded.length = 0;
  setPoolFactory(unreachablePool);
}

afterAll(async () => {
  setPoolFactory(null);
  await closeKnowledgePools();
});

/** The up-direction stamp statements, ignoring anything else a pool sees. */
function scopeStamps(): Recorded[] {
  return recorded.filter((entry) =>
    entry.text.includes('SET team_ids = $3::text[]'),
  );
}

/** The down-direction clears. */
function scopeClears(): Recorded[] {
  return recorded.filter((entry) =>
    entry.text.includes('SET team_ids = NULL, team_id = NULL'),
  );
}

defineMigrationTest({
  id: '0.4.1/04_backfill_corpus_document_scope',
  modules: buildModules(import.meta.glob('../../../../**/*.*s'), DIR),
  // org2 with NO documents exercises the per-org no-op path.
  orgs: [{ slug: 'org1' }, { slug: 'org2' }],

  async seed(ctx, orgs) {
    await armRecorder();
    const org = orgs[0];
    if (!org) throw new Error('harness seeded no org');
    const projectId: string = await ctx.db.insert('projects', {
      organizationId: org.id,
      name: 'Filing desk',
      createdBy: 'user_seed',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    });
    // One document per scope — including a MULTI-team one, the case that
    // used to lose every team after the first — plus a blob-less row the
    // walk must skip: a document that never had a file has no corpus row to
    // stamp.
    await ctx.db.insert('documents', {
      organizationId: org.id,
      title: 'team-handbook.pdf',
      fileId: 'kg_team_blob',
      teamId: 'team-sales',
      teamTags: ['team-sales'],
    });
    await ctx.db.insert('documents', {
      organizationId: org.id,
      title: 'shared-playbook.pdf',
      fileId: 'kg_shared_blob',
      teamId: 'team-sales',
      teamTags: ['team-sales', 'team-support'],
    });
    await ctx.db.insert('documents', {
      organizationId: org.id,
      title: 'project-spec.pdf',
      fileId: 'kg_project_blob',
      projectId,
    });
    await ctx.db.insert('documents', {
      organizationId: org.id,
      title: 'org-wide.pdf',
      fileId: 'kg_hub_blob',
    });
    await ctx.db.insert('documents', {
      organizationId: org.id,
      title: 'note-without-blob',
      content: 'inline only',
    });
  },

  async expectUp(world) {
    const stamps = scopeStamps();
    // Four documents carry a blob, so exactly four stamps — the blob-less
    // row never reaches the corpus, and org2 (no documents) issues nothing.
    expect(stamps).toHaveLength(4);
    for (const stamp of stamps) {
      expect(stamp.text).toContain('org_slug = $1 AND file_id = $2');
      // Guarded UPDATE — what makes a resumed fleet run a no-op.
      expect(stamp.text).toContain('IS DISTINCT FROM');
      expect(stamp.params[0]).toBe('org1');
    }
    // Params after (org, fileId): the full team list, its deprecated
    // first-element mirror, the project.
    const byFile = new Map(stamps.map((s) => [s.params[1], s.params]));
    expect(byFile.get('kg_team_blob')?.slice(2)).toEqual([
      ['team-sales'],
      'team-sales',
      null,
    ]);
    // The multi-team document keeps EVERY team — the single-column era
    // stamped only the first and silently hid it from the second team.
    expect(byFile.get('kg_shared_blob')?.slice(2)).toEqual([
      ['team-sales', 'team-support'],
      'team-sales',
      null,
    ]);
    const projectParams = byFile.get('kg_project_blob');
    const { projectId } = await world.run(async (ctx) => {
      const project = await ctx.db.query('projects').first();
      return { projectId: (project?._id ?? '') as string };
    });
    expect(projectParams?.slice(2)).toEqual([null, null, projectId]);
    expect(byFile.get('kg_hub_blob')?.slice(2)).toEqual([null, null, null]);
  },

  async expectDown(_world) {
    // `down` clears the scope columns per organization — one guarded
    // statement per org, no per-document walk.
    const clears = scopeClears();
    const orgs = clears.map((entry) => entry.params[0]);
    expect(orgs).toContain('org1');
    expect(orgs).toContain('org2');
  },

  cases: {
    // The chain — and any deployment whose knowledge database is not up yet —
    // must survive an unreachable corpus: the org is SKIPPED with a warning,
    // the run still lands `applied`, and the Convex world is untouched.
    'an unreachable corpus skips the org instead of failing the run': async (
      world,
    ) => {
      await armUnreachable();
      const before = await world.digest();
      await world.applyUpOnly();
      const after = await world.digest();
      expect(after).toEqual(before);
      const ledger = await world.ledgerRow();
      expect(ledger?.status).toBe('applied');
    },
  },
});
