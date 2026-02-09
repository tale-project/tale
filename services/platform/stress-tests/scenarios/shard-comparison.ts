/**
 * Shard Comparison Scenario
 *
 * Validates shard routing by running two phases and comparing metrics:
 *
 *   Phase A — "Single shard": 10 rapid starts with ONE definition ID
 *   Phase B — "Multi shard":  10 rapid starts spread across MULTIPLE definition IDs
 *
 * On local dev this primarily verifies that shard routing works correctly
 * (workflows start, complete, and land on expected shards). Meaningful latency
 * and OCC differences require staging/production conditions.
 *
 * Usage:
 *   npx tsx stress-tests/scenarios/shard-comparison.ts
 *
 * Requires:
 *   CONVEX_URL
 *   ORGANIZATION_ID
 *   WORKFLOW_DEFINITION_IDS  — comma-separated list of 2+ definition IDs
 *                              (duplicate your noop workflow under different names)
 */

import { ConvexHttpClient } from 'convex/browser';

import type { Id } from '../../convex/_generated/dataModel';

import { api } from '../../convex/_generated/api';
import { getShardIndex } from '../../convex/workflow_engine/helpers/engine/shard';
import { MetricsCollector } from '../metrics';
import { pollExecutionViaConvexRun } from '../poll';

const WORKFLOWS_PER_PHASE = 10;
const POLL_INTERVAL_MS = 2000;
const STUCK_THRESHOLD_MS = 3 * 60 * 1000;
const COOLDOWN_MS = 5000;

interface PhaseResult {
  label: string;
  totalStartMs: number;
  startTimings: number[];
  metrics: ReturnType<MetricsCollector['report']>;
}

async function runPhase(
  client: ConvexHttpClient,
  organizationId: string,
  definitionIds: string[],
  label: string,
): Promise<PhaseResult> {
  const metrics = new MetricsCollector();
  const startTimings: number[] = [];
  const executions: { id: string; executionId: Id<'wfExecutions'> | null }[] =
    [];

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Phase: ${label}`);
  console.log(`Definitions: ${definitionIds.length} unique`);

  const shardSet = new Set(definitionIds.map(getShardIndex));
  console.log(
    `Shards used: ${[...shardSet].sort().join(', ')} (${shardSet.size} distinct)`,
  );
  console.log(`Starting ${WORKFLOWS_PER_PHASE} workflows...\n`);

  const phaseStart = Date.now();

  for (let i = 0; i < WORKFLOWS_PER_PHASE; i++) {
    const defId = definitionIds[i % definitionIds.length];
    const id = `wf_${i}`;
    metrics.track(id);
    const t0 = Date.now();

    try {
      const executionId = await client.mutation(
        api.workflow_engine.mutations.startWorkflow,
        {
          organizationId,
          // Config stores string IDs — cast required for Convex API
          wfDefinitionId: defId as Id<'wfDefinitions'>,
          input: {
            stressTest: true,
            phase: label,
            index: i,
            timestamp: Date.now(),
          },
          triggeredBy: `stress-test:shard-comparison:${label}`,
          triggerData: { triggerType: 'manual', reason: 'shard-comparison' },
        },
      );
      const elapsed = Date.now() - t0;
      startTimings.push(elapsed);
      metrics.update(id, 'running');
      executions.push({ id, executionId });
      console.log(
        `  [${i + 1}/${WORKFLOWS_PER_PHASE}] Started in ${elapsed}ms (shard ${getShardIndex(defId)})`,
      );
    } catch (error) {
      const elapsed = Date.now() - t0;
      startTimings.push(elapsed);
      const msg = error instanceof Error ? error.message : String(error);
      metrics.update(id, 'failed', msg);
      executions.push({ id, executionId: null });
      console.log(
        `  [${i + 1}/${WORKFLOWS_PER_PHASE}] FAILED in ${elapsed}ms: ${msg}`,
      );
    }
  }

  const totalStartMs = Date.now() - phaseStart;
  const launched = executions.filter((e) => e.executionId);

  console.log(`\nAll starts completed in ${totalStartMs}ms`);
  console.log(`Launched: ${launched.length}/${WORKFLOWS_PER_PHASE}`);

  // Poll for completion
  const pending = new Map(
    launched
      .filter(
        (e): e is typeof e & { executionId: Id<'wfExecutions'> } =>
          e.executionId != null,
      )
      .map((e) => [e.id, e.executionId]),
  );
  const pollStart = Date.now();

  while (pending.size > 0) {
    if (Date.now() - pollStart > STUCK_THRESHOLD_MS) {
      for (const [id] of pending) metrics.markStuck(id);
      console.log(`\nTimeout: ${pending.size} still pending`);
      break;
    }

    for (const [id, executionId] of Array.from(pending.entries())) {
      const { status, error } = pollExecutionViaConvexRun(executionId);
      if (status === 'completed' || status === 'failed') {
        metrics.update(id, status, error);
        pending.delete(id);
      }
    }

    if (pending.size > 0) {
      const elapsed = ((Date.now() - pollStart) / 1000).toFixed(0);
      process.stdout.write(
        `\r  Pending: ${pending.size}/${launched.length}  (${elapsed}s)`,
      );
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  console.log('');
  const report = metrics.printReport();

  return {
    label,
    totalStartMs,
    startTimings,
    metrics: report,
  };
}

async function run() {
  const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL || '';
  const organizationId = process.env.ORGANIZATION_ID || '';
  const definitionIdsRaw = process.env.WORKFLOW_DEFINITION_IDS || '';

  if (!convexUrl || !organizationId || !definitionIdsRaw) {
    console.error(
      'Required env vars: CONVEX_URL, ORGANIZATION_ID, WORKFLOW_DEFINITION_IDS (comma-separated)',
    );
    process.exit(1);
  }

  const allDefinitionIds = definitionIdsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (allDefinitionIds.length < 2) {
    console.error(
      'WORKFLOW_DEFINITION_IDS must contain at least 2 IDs (comma-separated).\n' +
        'Create multiple noop workflow definitions to test multi-shard distribution.',
    );
    process.exit(1);
  }

  // Show shard mapping
  console.log('\nShard mapping for provided definitions:');
  for (const defId of allDefinitionIds) {
    console.log(`  ${defId} → shard ${getShardIndex(defId)}`);
  }

  const client = new ConvexHttpClient(convexUrl);

  // Phase A: Single shard — all starts use the first definition
  const singleShardResult = await runPhase(
    client,
    organizationId,
    [allDefinitionIds[0]],
    'single-shard',
  );

  // Cooldown between phases
  console.log(`\nCooling down ${COOLDOWN_MS / 1000}s between phases...`);
  await new Promise((r) => setTimeout(r, COOLDOWN_MS));

  // Phase B: Multi shard — starts distributed across all definitions
  const multiShardResult = await runPhase(
    client,
    organizationId,
    allDefinitionIds,
    'multi-shard',
  );

  // Comparison
  console.log('\n' + '═'.repeat(60));
  console.log('COMPARISON');
  console.log('═'.repeat(60));

  const a = singleShardResult;
  const b = multiShardResult;

  const avgStartA =
    a.startTimings.reduce((s, v) => s + v, 0) / a.startTimings.length;
  const avgStartB =
    b.startTimings.reduce((s, v) => s + v, 0) / b.startTimings.length;

  console.log(`\n${''.padEnd(28)} Single-shard    Multi-shard`);
  console.log(`${'─'.repeat(60)}`);
  console.log(
    `Start mutations total:   ${pad(a.totalStartMs)}ms      ${pad(b.totalStartMs)}ms`,
  );
  console.log(
    `Avg start latency:       ${pad(Math.round(avgStartA))}ms      ${pad(Math.round(avgStartB))}ms`,
  );
  console.log(
    `Success rate:            ${pad((a.metrics.successRate * 100).toFixed(1))}%       ${pad((b.metrics.successRate * 100).toFixed(1))}%`,
  );
  console.log(
    `Completion p50:          ${pad(a.metrics.latency.p50)}ms      ${pad(b.metrics.latency.p50)}ms`,
  );
  console.log(
    `Completion p95:          ${pad(a.metrics.latency.p95)}ms      ${pad(b.metrics.latency.p95)}ms`,
  );
  console.log(
    `Failed:                  ${pad(a.metrics.failed)}           ${pad(b.metrics.failed)}`,
  );
  console.log(
    `Stuck:                   ${pad(a.metrics.stuck)}           ${pad(b.metrics.stuck)}`,
  );

  if (avgStartB < avgStartA) {
    const improvement = ((1 - avgStartB / avgStartA) * 100).toFixed(0);
    console.log(`\nMulti-shard starts were ${improvement}% faster on average.`);
  } else {
    console.log(
      '\nNo measurable improvement (local dev may not show OCC contention).',
    );
  }

  console.log('═'.repeat(60));

  // Save report
  const fs = await import('fs');
  const report = {
    singleShard: { ...a },
    multiShard: { ...b },
    timestamp: Date.now(),
  };
  const reportPath = `stress-tests/report-shard-comparison-${Date.now()}.json`;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${reportPath}`);
}

function pad(v: string | number, width = 8): string {
  return String(v).padStart(width);
}

run().catch((err) => {
  console.error('Scenario failed:', err);
  process.exit(1);
});
