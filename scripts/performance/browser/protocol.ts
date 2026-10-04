// One app-free high-volume protocol control. No Tale assets/tasks/navigation.
import assert from 'node:assert/strict';

import { browserIdentity, launchBrowser } from './browser-identity.ts';
import { json, outputPath, sources } from './common.ts';
import { diagnosticTraceCategories } from './phase.ts';
import { fillProtocolBuffer, protocolPlan } from './protocol-plan.ts';
import { traceControls } from './trace-controls.ts';
import { observeTrace } from './trace-session.ts';
import { finishProfile, saveRawTrace } from './trace.ts';

assert.equal(
  (await sources()).mode,
  'protocol',
  'Protocol entrypoint requires explicit admission',
);
const identity = await browserIdentity();
const receipt: Record<string, unknown> = {
  mode: 'protocol',
  accepted: false,
  performanceVerdict: 'not-evaluated',
  identity,
  plan: protocolPlan,
  limitation:
    'Long uniquely named user-timing marks target similar buffer occupancy, not the app event mix; outcomes do not establish the cause of the app timeout.',
  complete: false,
  fill: [],
};
await json('protocol-control.json', receipt);
try {
  await traceControls(identity);
  const browser = await launchBrowser(identity);
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const owner = observeTrace(cdp);
    let traceStarted = false;
    let profileStarted = false;
    let failure: unknown;
    const usage: { at: number; value: number }[] = [];
    let cursor = 0;
    let telemetryError: unknown;
    const recordUsage = (event: { percentFull?: number }) => {
      if (usage.length >= 1000) {
        telemetryError = new Error('Protocol telemetry exceeded bound');
        return;
      }
      if (typeof event.percentFull !== 'number') {
        telemetryError = new Error('Missing trace buffer occupancy');
        receipt.badBufferEvent = event;
        return;
      }
      usage.push({ at: Date.now(), value: event.percentFull });
    };
    cdp.on('Tracing.bufferUsage', recordUsage);
    try {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
      profileStarted = true;
      await cdp.send('Tracing.start', {
        categories: diagnosticTraceCategories,
        transferMode: 'ReturnAsStream',
        bufferUsageReportingInterval: 1000,
      });
      traceStarted = true;
      receipt.startedAt = Date.now();
      receipt.filled = await fillProtocolBuffer({
        now: Date.now,
        emitBatch: async (index) => {
          await page.evaluate(
            ({ batch, marks, bytes }) => {
              const padding = 'x'.repeat(bytes);
              for (let mark = 0; mark < marks; mark += 1)
                performance.mark(`owned-control-${batch}-${mark}-${padding}`);
              performance.clearMarks();
            },
            {
              batch: index,
              marks: protocolPlan.marksPerBatch,
              bytes: protocolPlan.nameBytes,
            },
          );
          // Require telemetry after emission has finished; an event delivered
          // during the batch cannot establish its final occupancy.
          cursor = usage.length;
        },
        nextUsage: async () => {
          const end = Date.now() + 2500;
          while (usage.length <= cursor && Date.now() < end)
            await new Promise((resolve) => setTimeout(resolve, 20));
          assert(!telemetryError, String(telemetryError));
          const current = usage.at(-1);
          assert(
            current && usage.length > cursor,
            'Fresh buffer telemetry did not arrive',
          );
          return current.value;
        },
        checkpoint: async (value) => {
          (receipt.fill as unknown[]).push(value);
          await json('protocol-control.json', receipt);
        },
      });
    } catch (error) {
      failure = error;
      receipt.actionError = String(error);
      // Only this disposable control page: stop any evaluation still in
      // flight when the strict fill deadline/refusal fires.
      try {
        await cdp.send('Runtime.terminateExecution');
      } catch (terminationError) {
        receipt.terminationError = String(terminationError);
      }
    }
    const coverageEndAt = Date.now();
    receipt.actionFinishedAt = coverageEndAt;
    // Finalization always runs, including failed fill/readiness. The extra
    // window retains late bytes but saveRawTrace still throws at a15s miss.
    const retained = await Promise.allSettled([
      profileStarted
        ? finishProfile(cdp, outputPath('control-volume.cpuprofile'))
        : Promise.resolve({ notStarted: true }),
      traceStarted
        ? saveRawTrace(cdp, outputPath('control-volume.trace.json'), {
            owner,
            coverageEndAt,
            lateObservationMs: protocolPlan.lateObservationMs,
          })
        : Promise.resolve({ notStarted: true }),
    ]);
    const cleanupErrors = await owner.dispose();
    cdp.off('Tracing.bufferUsage', recordUsage);
    Object.assign(receipt, {
      finishedAt: Date.now(),
      usage,
      cleanupErrors,
      retained: retained.map((result) =>
        result.status === 'fulfilled'
          ? { status: 'complete', ...result.value }
          : { status: 'failed', error: String(result.reason) },
      ),
    });
    await json('protocol-control.json', receipt);
    if (failure) throw failure;
    assert(!telemetryError, String(telemetryError));
    assert.deepEqual(cleanupErrors, []);
    assert(
      retained.every((result) => result.status === 'fulfilled'),
      'Protocol control failed; late/partial evidence retained without changing15s verdict',
    );
  } finally {
    await browser.close();
  }
  receipt.complete = true;
} catch (error) {
  receipt.error = String(error);
  throw error;
} finally {
  await json('protocol-control.json', receipt);
}
