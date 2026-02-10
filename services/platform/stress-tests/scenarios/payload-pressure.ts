/**
 * Payload Pressure Scenario
 *
 * Starts 10 workflows each carrying 500KB+ input payloads.
 * Tests variable serialization under load and storage spill (>400KB
 * threshold triggers storage rather than inline serialization).
 *
 * Usage:
 *   npx tsx stress-tests/scenarios/payload-pressure.ts
 *
 * Requires: CONVEX_URL, ORGANIZATION_ID, WORKFLOW_DEFINITION_ID
 */

import { ConvexHttpClient } from 'convex/browser';

import type { Id } from '../../convex/_generated/dataModel';
import type { ExecutionStatus } from '../metrics';

import { api } from '../../convex/_generated/api';
import { scenarios } from '../fixtures/stress-workflows';
import { MetricsCollector } from '../metrics';

const config = scenarios.heavy_payload;

function generateLargePayload(sizeKb: number): Record<string, unknown> {
  const chunkSize = 1024;
  const chunks = Math.ceil((sizeKb * 1024) / chunkSize);
  const data: Record<string, string> = {};
  for (let i = 0; i < chunks; i++) {
    data[`field_${i}`] = 'x'.repeat(chunkSize);
  }
  return data;
}

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
  const rawPayloadSize = config.inputOverrides?.payloadSizeKb;
  const payloadSizeKb =
    typeof rawPayloadSize === 'number' ? rawPayloadSize : 500;

  console.log(`\n[${config.name}] ${config.description}`);
  console.log(
    `${config.total} workflows with ~${payloadSizeKb}KB payloads each\n`,
  );

  const executionMap = new Map<string, Id<'wfExecutions'>>();

  const launches = Array.from({ length: config.total }, async (_, i) => {
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
            largePayload: true,
            scenarioIndex: i,
            timestamp: Date.now(),
            payload: generateLargePayload(payloadSizeKb),
          },
          triggeredBy: 'stress-test:payload-pressure',
          triggerData: {
            triggerType: 'manual',
            reason: 'payload-pressure',
            payloadSizeKb,
          },
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

  await Promise.all(launches);
  console.log(
    `Started: ${executionMap.size}/${config.total} | Failed: ${config.total - executionMap.size}`,
  );

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
  const reportPath = `stress-tests/report-payload-${Date.now()}.json`;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Report: ${reportPath}`);
}

run().catch((err) => {
  console.error('Scenario failed:', err);
  process.exit(1);
});
