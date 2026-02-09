/**
 * Sustained Load Scenario
 *
 * Starts 5 workflows every 2 seconds for 5 minutes (150 total).
 * Tests system stability under continuous, moderate pressure without
 * overwhelming the workpool in a single burst.
 *
 * Usage:
 *   npx tsx stress-tests/scenarios/sustained-load.ts
 *
 * Requires: CONVEX_URL, ORGANIZATION_ID, WORKFLOW_DEFINITION_ID
 */

import { ConvexHttpClient } from 'convex/browser';

import type { Id } from '../../convex/_generated/dataModel';
import type { ExecutionStatus } from '../metrics';

import { api } from '../../convex/_generated/api';
import { scenarios } from '../fixtures/stress-workflows';
import { MetricsCollector } from '../metrics';

const config = scenarios.sustained_load;
const BATCH_INTERVAL_MS = 2000;
const BATCH_SIZE = 5;

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
    `${config.total} workflows, ${BATCH_SIZE} every ${BATCH_INTERVAL_MS}ms\n`,
  );

  const executionMap = new Map<string, Id<'wfExecutions'>>();
  let launched = 0;
  const batchCount = Math.ceil(config.total / BATCH_SIZE);

  for (let batch = 0; batch < batchCount; batch++) {
    const batchSize = Math.min(BATCH_SIZE, config.total - launched);

    const batchPromises = Array.from({ length: batchSize }, async (_, i) => {
      const idx = launched + i;
      const id = `wf_${idx}`;
      metrics.track(id);

      try {
        const executionId = await client.mutation(
          api.workflow_engine.mutations.startWorkflow,
          {
            organizationId,
            // Config stores string IDs — cast required for Convex API
            wfDefinitionId: wfDefinitionId as Id<'wfDefinitions'>,
            input: {
              stressTest: true,
              scenarioIndex: idx,
              batchNumber: batch,
              timestamp: Date.now(),
            },
            triggeredBy: 'stress-test:sustained-load',
            triggerData: { triggerType: 'manual', reason: 'sustained-load' },
          },
        );
        metrics.update(id, 'running');
        executionMap.set(id, executionId);
      } catch (error) {
        metrics.update(
          id,
          'failed',
          error instanceof Error ? error.message : String(error),
        );
      }
    });

    await Promise.all(batchPromises);
    launched += batchSize;

    process.stdout.write(
      `\r  Launched: ${launched}/${config.total}  (batch ${batch + 1}/${batchCount})`,
    );

    if (batch < batchCount - 1) {
      await new Promise((r) => setTimeout(r, BATCH_INTERVAL_MS));
    }
  }

  console.log('\nAll workflows launched. Polling for completion...');

  // Poll until done
  const pending = new Set(executionMap.keys());
  const startTime = Date.now();

  while (pending.size > 0) {
    if (Date.now() - startTime > config.stuckThresholdMs) {
      for (const id of pending) metrics.markStuck(id);
      console.log(`\nTimeout: ${pending.size} still pending`);
      break;
    }

    const batch = Array.from(pending).slice(0, 20);
    await Promise.all(
      batch.map(async (id) => {
        const executionId = executionMap.get(id);
        if (!executionId) return;

        try {
          const execution = await client.query(
            api.wf_executions.queries.getRawExecution,
            { executionId },
          );
          if (!execution) return;
          const status = execution.status as ExecutionStatus;
          if (status === 'completed' || status === 'failed') {
            const metadata = execution.metadata
              ? JSON.parse(execution.metadata)
              : {};
            metrics.update(id, status, metadata.error);
            pending.delete(id);
          }
        } catch {
          // transient
        }
      }),
    );

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

  const fs = await import('fs');
  const reportPath = `stress-tests/report-sustained-${Date.now()}.json`;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Report: ${reportPath}`);
}

run().catch((err) => {
  console.error('Scenario failed:', err);
  process.exit(1);
});
