/**
 * Workflow Stress Test Runner
 *
 * Launches concurrent workflows against a Convex backend and measures
 * success rates, latency, and failure patterns.
 *
 * Usage:
 *   npx tsx stress-tests/run-stress-test.ts --concurrency 10 --total 50
 *
 * Requires:
 *   CONVEX_URL - deployment URL (e.g. from .env.local or convex.json)
 *   WORKFLOW_DEFINITION_ID - ID of the workflow to stress test
 *   ORGANIZATION_ID - organization context for workflows
 */

import { ConvexHttpClient } from 'convex/browser';

import type { Id } from '../convex/_generated/dataModel';
import type { ExecutionStatus } from './metrics';

import { api } from '../convex/_generated/api';
import { MetricsCollector } from './metrics';

interface StressTestConfig {
  convexUrl: string;
  organizationId: string;
  wfDefinitionId: string;
  concurrency: number;
  total: number;
  rampUpSeconds: number;
  pollIntervalMs: number;
  stuckThresholdMs: number;
}

function parseArgs(): Partial<StressTestConfig> {
  const args = process.argv.slice(2);
  const config: Record<string, string> = {};

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    const value = args[i + 1];
    if (key && value) config[key] = value;
  }

  return {
    concurrency: config.concurrency ? parseInt(config.concurrency) : undefined,
    total: config.total ? parseInt(config.total) : undefined,
    rampUpSeconds: config['ramp-up'] ? parseInt(config['ramp-up']) : undefined,
    wfDefinitionId: config.workflow ?? undefined,
    organizationId: config.org ?? undefined,
  };
}

function getConfig(): StressTestConfig {
  const args = parseArgs();

  const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL || '';

  if (!convexUrl) {
    console.error('Error: CONVEX_URL environment variable is required.');
    console.error(
      'Set it to your Convex deployment URL (e.g. https://your-deployment.convex.cloud)',
    );
    process.exit(1);
  }

  const organizationId =
    args.organizationId || process.env.ORGANIZATION_ID || '';
  const wfDefinitionId =
    args.wfDefinitionId || process.env.WORKFLOW_DEFINITION_ID || '';

  if (!organizationId || !wfDefinitionId) {
    console.error(
      'Error: ORGANIZATION_ID and WORKFLOW_DEFINITION_ID are required.',
    );
    console.error('Pass via env vars or --org / --workflow flags.');
    process.exit(1);
  }

  return {
    convexUrl,
    organizationId,
    wfDefinitionId,
    concurrency: args.concurrency ?? 10,
    total: args.total ?? 50,
    rampUpSeconds: args.rampUpSeconds ?? 0,
    pollIntervalMs: 2000,
    stuckThresholdMs: 5 * 60 * 1000, // 5 minutes
  };
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startWorkflow(
  client: ConvexHttpClient,
  config: StressTestConfig,
): Promise<Id<'wfExecutions'>> {
  const executionId = await client.mutation(
    api.workflow_engine.mutations.startWorkflow,
    {
      organizationId: config.organizationId,
      // Config stores string IDs — cast required for Convex API
      wfDefinitionId: config.wfDefinitionId as Id<'wfDefinitions'>,
      input: {
        stressTest: true,
        timestamp: Date.now(),
      },
      triggeredBy: 'stress-test',
      triggerData: {
        triggerType: 'manual',
        reason: 'stress-test',
        timestamp: Date.now(),
      },
    },
  );
  return executionId;
}

async function pollExecution(
  client: ConvexHttpClient,
  executionId: Id<'wfExecutions'>,
): Promise<{ status: ExecutionStatus; error?: string }> {
  const execution = await client.query(
    api.wf_executions.queries.getRawExecution,
    { executionId },
  );

  if (!execution) {
    return { status: 'failed', error: 'Execution not found' };
  }

  const metadata = execution.metadata ? JSON.parse(execution.metadata) : {};

  return {
    // Convex schema uses v.string() — cast needed to narrow to our status union
    status: execution.status as ExecutionStatus,
    error: metadata.error,
  };
}

async function runStressTest() {
  const config = getConfig();
  const client = new ConvexHttpClient(config.convexUrl);
  const metrics = new MetricsCollector();

  console.log('Stress Test Configuration:');
  console.log(`  Convex URL:        ${config.convexUrl}`);
  console.log(`  Organization:      ${config.organizationId}`);
  console.log(`  Workflow:          ${config.wfDefinitionId}`);
  console.log(`  Concurrency:       ${config.concurrency}`);
  console.log(`  Total workflows:   ${config.total}`);
  console.log(`  Ramp-up:           ${config.rampUpSeconds}s`);
  console.log('');

  // Launch workflows in batches
  const executionIds: Id<'wfExecutions'>[] = [];
  const batchCount = Math.ceil(config.total / config.concurrency);
  const delayBetweenBatches =
    config.rampUpSeconds > 0 ? (config.rampUpSeconds * 1000) / batchCount : 0;

  console.log(
    `Starting ${config.total} workflows in ${batchCount} batch(es)...`,
  );

  for (let batch = 0; batch < batchCount; batch++) {
    const batchSize = Math.min(
      config.concurrency,
      config.total - batch * config.concurrency,
    );

    const batchPromises = Array.from({ length: batchSize }, async () => {
      try {
        const executionId = await startWorkflow(client, config);
        metrics.track(executionId);
        executionIds.push(executionId);
        return executionId;
      } catch (error) {
        const id = `failed_${Date.now()}_${Math.random()}`;
        metrics.track(id);
        metrics.update(
          id,
          'failed',
          error instanceof Error ? error.message : String(error),
        );
        return null;
      }
    });

    await Promise.all(batchPromises);

    if (delayBetweenBatches > 0 && batch < batchCount - 1) {
      await sleep(delayBetweenBatches);
    }
  }

  console.log(`All ${executionIds.length} workflows started. Polling...`);

  // Poll until all complete or stuck
  const startTime = Date.now();
  const pendingIds = new Set(executionIds);

  while (pendingIds.size > 0) {
    const elapsed = Date.now() - startTime;

    // Check for stuck executions
    if (elapsed > config.stuckThresholdMs) {
      for (const id of pendingIds) {
        metrics.markStuck(id);
      }
      console.log(
        `Timeout: ${pendingIds.size} executions still pending after ${config.stuckThresholdMs / 1000}s`,
      );
      break;
    }

    // Poll batch
    const pollBatch = Array.from(pendingIds).slice(0, 20);
    await Promise.all(
      pollBatch.map(async (id) => {
        try {
          const { status, error } = await pollExecution(client, id);
          metrics.update(id, status, error);

          if (status === 'completed' || status === 'failed') {
            pendingIds.delete(id);
          }
        } catch {
          // Poll failures are transient, retry next cycle
        }
      }),
    );

    const remaining = pendingIds.size;
    if (remaining > 0) {
      process.stdout.write(
        `\r  Pending: ${remaining}/${executionIds.length}  (${(elapsed / 1000).toFixed(0)}s elapsed)`,
      );
      await sleep(config.pollIntervalMs);
    }
  }

  console.log('');
  const report = metrics.printReport();

  // Write JSON report
  const reportPath = `stress-tests/report-${Date.now()}.json`;
  const fs = await import('fs');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nJSON report written to: ${reportPath}`);
}

runStressTest().catch((error) => {
  console.error('Stress test failed:', error);
  process.exit(1);
});
