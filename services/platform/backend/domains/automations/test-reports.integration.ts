/** Real Postgres proof of the test report a version keeps beside its tests
 * verdict (migration 0200): a save, a run by hand and the deploy gate each
 * store what their check found, which act made it and who; a version's
 * history counts it and its report reads back whole; a verdict made without
 * a report — by an older image during a roll, say — leaves no report that
 * would contradict it; and the act column takes only the three acts. The
 * lane deletes what it wrote before it ends. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import type { TestReport } from '../../../lib/engine/api/tests.ts';
import { appOrigin } from '../../lib/write-origin.ts';
import {
  deleteAutomationCascade,
  deploy,
  recordTestVerdict,
  saveVersion,
  setTestsVerdict,
} from './store.ts';
import { listVersionHistory, readTestReport } from './versions.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

/** A report of two tests, the second failing when `passing` is false. */
function report(passing: boolean): TestReport {
  return {
    passed: passing ? 2 : 1,
    failed: passing ? 0 : 1,
    results: [
      { name: 'greets', index: 0, pass: true, ms: 1 },
      {
        name: 'signs off',
        index: 1,
        pass: passing,
        ms: 2,
        ...(!passing && {
          message: 'the run succeeded where the test expects it to fail',
          failures: [
            { kind: 'run_succeeded' as const, expected: { node: 'say' } },
          ],
        }),
      },
    ],
  };
}

export async function checkTestReports(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const name = `itest-test-reports-${randomUUID().slice(0, 8)}`;
  const origin = appOrigin(userId);
  const document = {
    version: 1,
    name,
    nodes: [{ id: 'say', type: 'transform', code: "return 'hi';" }],
    output: '{{ nodes.say.output }}',
  };
  const history = async (version: number) =>
    (await listVersionHistory(sql, orgId, name)).versions.find(
      (row) => row.version === version,
    );

  try {
    await saveVersion(sql, {
      organizationId: orgId,
      name,
      document,
      origin,
      testsPassed: false,
      testReport: report(false),
    });
    const saved = await readTestReport(sql, orgId, name, 1);
    const savedRow = await history(1);
    const failure = saved?.report?.results[1];
    record(
      'a save keeps the report its verdict came from, which act made it and who [AUTO-R50]',
      saved?.testsPassed === false &&
        saved.via === 'save' &&
        saved.by === userId &&
        saved.report?.checkedAt === saved.testsCheckedAt &&
        failure !== undefined &&
        !failure.pass &&
        'failures' in failure &&
        failure.failures?.[0]?.kind === 'run_succeeded' &&
        savedRow?.tests?.passed === 1 &&
        savedRow.tests.failed === 1 &&
        savedRow.tests.total === 2 &&
        savedRow.tests.via === 'save',
      JSON.stringify({ saved, tests: savedRow?.tests }),
    );

    await recordTestVerdict(sql, {
      organizationId: orgId,
      name,
      version: 1,
      testsPassed: true,
      check: { report: report(true), via: 'manual', by: userId },
    });
    const byHand = await readTestReport(sql, orgId, name, 1);
    record(
      'tests run by hand replace the verdict and its report [AUTO-R50]',
      byHand?.testsPassed === true &&
        byHand.via === 'manual' &&
        byHand.report?.passed === 2 &&
        (await history(1))?.tests?.via === 'manual',
      JSON.stringify(byHand),
    );

    await deploy(sql, {
      organizationId: orgId,
      name,
      version: 1,
      origin,
      testsPassed: true,
      testReport: report(true),
    });
    const gated = await readTestReport(sql, orgId, name, 1);
    record(
      "the deploy gate's verdict keeps its report too [AUTO-R50]",
      gated?.via === 'deploy' &&
        gated.by === userId &&
        gated.report?.failed === 0,
      JSON.stringify(gated),
    );

    // A verdict without a report — an older image's, during a roll — must
    // not read as the report of the checks that came before it.
    await setTestsVerdict(sql, {
      organizationId: orgId,
      name,
      version: 1,
      testsPassed: false,
    });
    const bare = await readTestReport(sql, orgId, name, 1);
    record(
      'a verdict made without a report leaves no report that contradicts it [AUTO-R50]',
      bare?.testsPassed === false &&
        bare.report === null &&
        (await history(1))?.tests === null,
      JSON.stringify(bare),
    );

    const refused = await sql`
      UPDATE app.automations SET tests_checked_via = 'guess'
      WHERE org_id = ${orgId} AND name = ${name} AND version = 1
    `.then(
      () => null,
      (error: unknown) => error,
    );
    record(
      'the act a check was made by is one of save, deploy and manual [AUTO-R50]',
      refused instanceof Error && /check/i.test(refused.message),
      refused instanceof Error ? refused.message : 'accepted',
    );
    record(
      'a version that does not exist has no test report',
      (await readTestReport(sql, orgId, name, 99)) === undefined,
      'read v99',
    );
  } finally {
    await deleteAutomationCascade(sql, {
      organizationId: orgId,
      name,
      origin,
    }).catch((error: unknown) => {
      console.warn(
        `[itest] cleanup of ${name}:`,
        error instanceof Error ? error.message : error,
      );
    });
  }
}
