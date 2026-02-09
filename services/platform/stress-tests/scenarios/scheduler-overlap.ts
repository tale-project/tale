/**
 * Scheduler Overlap Scenario
 *
 * Functional smoke test: fires 6 workflows in rapid sequence to verify all
 * start and complete without functional errors. Mirrors the production pattern
 * where multiple scheduled workflows trigger at the same time.
 *
 * Does NOT reproduce OCC contention on local dev — that requires production-level
 * concurrency and memory pressure. Point CONVEX_URL at staging/production for
 * before/after comparisons when deploying contention fixes.
 *
 * Usage:
 *   npx tsx stress-tests/scenarios/scheduler-overlap.ts
 *
 * Requires: CONVEX_URL, ORGANIZATION_ID, WORKFLOW_DEFINITION_ID
 */

import { ConvexHttpClient } from 'convex/browser';

import { api } from '../../convex/_generated/api';
import { scenarios } from '../fixtures/stress-workflows';
import { MetricsCollector } from '../metrics';
import { pollExecutionViaConvexRun } from '../poll';

const config = scenarios.scheduler_overlap;

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
    'Firing 6 workflows in rapid sequence (no jitter, mimics old scanAndTrigger)...\n',
  );

  const executionMap = new Map<string, string>();
  const launchTimings: { id: string; startMs: number; endMs: number }[] = [];

  // Sequential rapid-fire starts (no delay between them)
  for (let i = 0; i < config.total; i++) {
    const id = `wf_${i}`;
    metrics.track(id);
    const startMs = Date.now();

    try {
      const executionId = await client.mutation(
        api.workflow_engine.mutations.startWorkflow,
        {
          organizationId,
          wfDefinitionId: wfDefinitionId as never,
          input: {
            stressTest: true,
            scenarioIndex: i,
            simulatedSchedule: [
              'document_rag_sync',
              'onedrive_sync',
              'customer_status_assessment',
              'product_recommendation',
              'product_recommendation_email',
              'conversation_auto_archive',
            ][i],
            timestamp: Date.now(),
          },
          triggeredBy: 'stress-test:scheduler-overlap',
          triggerData: {
            triggerType: 'scheduled',
            reason: 'scheduler-overlap-simulation',
          },
        },
      );
      const endMs = Date.now();
      metrics.update(id, 'running');
      executionMap.set(id, executionId);
      launchTimings.push({ id, startMs, endMs });
      console.log(`  [${i + 1}/6] Started in ${endMs - startMs}ms`);
    } catch (error) {
      const endMs = Date.now();
      launchTimings.push({ id, startMs, endMs });
      const msg = error instanceof Error ? error.message : String(error);
      metrics.update(id, 'failed', msg);
      console.log(`  [${i + 1}/6] FAILED in ${endMs - startMs}ms: ${msg}`);
    }
  }

  const totalLaunchTime =
    launchTimings.length > 0
      ? launchTimings[launchTimings.length - 1].endMs - launchTimings[0].startMs
      : 0;

  console.log(`\nAll 6 launches completed in ${totalLaunchTime}ms total`);
  console.log(
    `Started: ${executionMap.size}/${config.total} | Failed at launch: ${config.total - executionMap.size}`,
  );

  // Poll for completion via npx convex run (getRawExecution is internalQuery)
  const pending = new Set(executionMap.keys());
  const startTime = Date.now();

  while (pending.size > 0) {
    if (Date.now() - startTime > config.stuckThresholdMs) {
      for (const id of pending) metrics.markStuck(id);
      console.log(`\nTimeout: ${pending.size} still pending`);
      break;
    }

    for (const id of Array.from(pending)) {
      const executionId = executionMap.get(id);
      if (!executionId) continue;

      const { status, error } = pollExecutionViaConvexRun(executionId);
      if (status === 'completed' || status === 'failed') {
        metrics.update(id, status, error);
        pending.delete(id);
      }
    }

    if (pending.size > 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      process.stdout.write(
        `\r  Pending: ${pending.size}/${executionMap.size}  (${elapsed}s)`,
      );
      await new Promise((r) => setTimeout(r, config.pollIntervalMs));
    }
  }

  console.log('');
  const report = metrics.printReport();

  const fullReport = {
    ...report,
    launchTimings,
    totalLaunchTimeMs: totalLaunchTime,
  };

  const fs = await import('fs');
  const reportPath = `stress-tests/report-scheduler-${Date.now()}.json`;
  fs.writeFileSync(reportPath, JSON.stringify(fullReport, null, 2));
  console.log(`Report: ${reportPath}`);
}

run().catch((err) => {
  console.error('Scenario failed:', err);
  process.exit(1);
});
