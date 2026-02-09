/**
 * Concurrent Starts Scenario
 *
 * Functional smoke test: launches 50 workflows simultaneously to verify the
 * engine handles parallel starts without functional failures (missing executions,
 * stuck workflows, incorrect status). Does NOT reproduce OCC contention — that
 * requires production-level concurrency and memory pressure.
 *
 * Point CONVEX_URL at staging/production for meaningful contention testing.
 *
 * Usage:
 *   npx tsx stress-tests/scenarios/concurrent-starts.ts
 *
 * Requires: CONVEX_URL, ORGANIZATION_ID, WORKFLOW_DEFINITION_ID
 */

import { ConvexHttpClient } from 'convex/browser';

import type { Id } from '../../convex/_generated/dataModel';

import { api } from '../../convex/_generated/api';
import { scenarios } from '../fixtures/stress-workflows';
import { MetricsCollector } from '../metrics';
import { pollExecutionViaConvexRun } from '../poll';

const config = scenarios.rapid_fire;

async function run() {
  const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL || '';
  const organizationId = process.env.ORGANIZATION_ID || '';
  const wfDefinitionId = process.env.WORKFLOW_DEFINITION_ID || '';

  if (!convexUrl || !organizationId || !wfDefinitionId) {
    console.error(
      'Required env vars: CONVEX_URL, ORGANIZATION_ID, WORKFLOW_DEFINITION_ID',
    );
    process.exit(1);
  }

  const client = new ConvexHttpClient(convexUrl);
  const metrics = new MetricsCollector();

  console.log(`\n[${config.name}] ${config.description}`);
  console.log(
    `Launching ${config.total} workflows (concurrency: ${config.concurrency})...\n`,
  );

  const startPromises = Array.from({ length: config.total }, async (_, i) => {
    const id = `wf_${i}`;
    metrics.track(id);
    try {
      const executionId = await client.mutation(
        api.workflow_engine.mutations.startWorkflow,
        {
          organizationId,
          wfDefinitionId: wfDefinitionId as Id<'wfDefinitions'>,
          input: {
            stressTest: true,
            scenarioIndex: i,
            timestamp: Date.now(),
          },
          triggeredBy: 'stress-test:concurrent-starts',
          triggerData: { triggerType: 'manual', reason: 'concurrent-starts' },
        },
      );
      metrics.update(id, 'running');
      return { id, executionId };
    } catch (error) {
      metrics.update(
        id,
        'failed',
        error instanceof Error ? error.message : String(error),
      );
      return { id, executionId: null };
    }
  });

  const results = await Promise.all(startPromises);
  const launched = results.filter((r) => r.executionId);

  console.log(
    `Started: ${launched.length}/${config.total} | Failed at launch: ${config.total - launched.length}`,
  );

  // Poll for completion via npx convex run (getRawExecution is internalQuery)
  const pending = new Map(
    launched
      .filter(
        (r): r is typeof r & { executionId: Id<'wfExecutions'> } =>
          r.executionId != null,
      )
      .map((r) => [r.id, r.executionId]),
  );
  const startTime = Date.now();

  while (pending.size > 0) {
    if (Date.now() - startTime > config.stuckThresholdMs) {
      for (const [id] of pending) metrics.markStuck(id);
      console.log(`\nTimeout: ${pending.size} still pending`);
      break;
    }

    const batch = Array.from(pending.entries()).slice(0, 20);
    for (const [id, executionId] of batch) {
      const { status, error } = pollExecutionViaConvexRun(executionId);
      if (status === 'completed' || status === 'failed') {
        metrics.update(id, status, error);
        pending.delete(id);
      }
    }

    if (pending.size > 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      process.stdout.write(
        `\r  Pending: ${pending.size}/${launched.length}  (${elapsed}s)`,
      );
      await new Promise((r) => setTimeout(r, config.pollIntervalMs));
    }
  }

  console.log('');
  const report = metrics.printReport();

  const fs = await import('fs');
  const reportPath = `stress-tests/report-concurrent-${Date.now()}.json`;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Report: ${reportPath}`);
}

run().catch((err) => {
  console.error('Scenario failed:', err);
  process.exit(1);
});
