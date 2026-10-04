import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

import type { CDPSession } from '../../../packages/e2e/src/index.ts';
import { observeTrace } from './trace-session.ts';
import { finishProfile, saveRawTrace } from './trace.ts';

export const diagnosticTraceCategories =
  'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline.stack,disabled-by-default-devtools.timeline.invalidationTracking';

// Periodic CPU sampling stays separate from the legacy timeline.stack category,
// which forces inspector CPU samples. Only the dialog causal mode selects this.
export const dialogTraceCategories =
  'devtools.timeline,blink.user_timing,v8,disabled-by-default-devtools.timeline.invalidationTracking';

/** A completed action remains observable even if protocol finalization fails. */
export async function capturePhase<T>(
  cdp: CDPSession,
  prefix: string,
  action: () => Promise<T>,
  checkpoint: (value: T) => Promise<void> = async () => {},
  mode: 'diagnostic' | 'dialog' = 'diagnostic',
) {
  assert(
    mode === 'diagnostic' || mode === 'dialog',
    'Unknown trace phase mode',
  );
  const categories =
    mode === 'dialog' ? dialogTraceCategories : diagnosticTraceCategories;
  const write = (suffix: string, value: unknown) =>
    writeFile(`${prefix}.${suffix}.json`, JSON.stringify(value, null, 2), {
      flag: 'wx',
      mode: 0o600,
    });
  const stages: { name: string; at: number }[] = [];
  const stage = (name: string) => stages.push({ name, at: Date.now() });
  const bufferUsage: { at: number; value: unknown }[] = [];
  let bufferOverflow = false;
  const recordBuffer = (value: unknown) => {
    if (bufferUsage.length >= 1000) bufferOverflow = true;
    else bufferUsage.push({ at: Date.now(), value });
  };
  cdp.on('Tracing.bufferUsage', recordBuffer);
  const traceOwner = observeTrace(cdp);
  let coverageEndAt: number | undefined;
  let profileStarted = false;
  let traceStarted = false;
  let value: T | undefined;
  let failure: unknown;
  const evidenceErrors: unknown[] = [];
  try {
    stage('profiler-enable-requested');
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.start');
    profileStarted = true;
    stage('profiler-started');
    await cdp.send('Tracing.start', {
      categories,
      transferMode: 'ReturnAsStream',
      bufferUsageReportingInterval: 1000,
    });
    traceStarted = true;
    stage('trace-started');
    value = await action();
    coverageEndAt = Date.now();
    stage('action-complete');
    await write('action', {
      status: 'action-complete',
      traceCompletionRequired: true,
      accepted: false,
      at: Date.now(),
      result: value,
    });
    await checkpoint(value);
    stage('checkpoint-complete');
  } catch (error) {
    failure = error;
    try {
      await write('action-failure', { error: String(error), stages });
    } catch (writeError) {
      evidenceErrors.push(writeError);
    }
  }
  coverageEndAt ??= Date.now();
  stage('finalization-started');
  const retained = await Promise.allSettled([
    profileStarted
      ? finishProfile(cdp, `${prefix}.cpuprofile`)
      : Promise.resolve({ notStarted: true }),
    traceStarted
      ? saveRawTrace(cdp, `${prefix}.trace.json`, {
          owner: traceOwner,
          coverageEndAt,
        })
      : Promise.resolve({ notStarted: true }),
  ]);
  const ownershipErrors = await traceOwner.dispose();
  evidenceErrors.push(...ownershipErrors);
  cdp.off('Tracing.bufferUsage', recordBuffer);
  stage('finalization-settled');
  const metadata = await Promise.allSettled([
    write(
      'capture',
      retained.map((result) =>
        result.status === 'fulfilled'
          ? { status: 'complete', ...result.value }
          : { status: 'incomplete', error: String(result.reason) },
      ),
    ),
    write('stages', {
      mode,
      categories,
      stages,
      bufferUsage,
      bufferOverflow,
      completionEvents: traceOwner.events,
      failure: failure ? String(failure) : undefined,
      evidenceErrors: evidenceErrors.map(String),
    }),
  ]);
  for (const result of metadata)
    if (result.status === 'rejected') evidenceErrors.push(result.reason);
  if (evidenceErrors.length)
    throw new AggregateError(
      [...(failure ? [failure] : []), ...evidenceErrors],
      `Phase evidence failed${failure ? `: ${String(failure)}` : ''}`,
    );
  if (failure) throw failure;
  assert(!bufferOverflow, 'CDP buffer telemetry exceeded its evidence bound');
  assert(
    retained.every((result) => result.status === 'fulfilled'),
    'Profile or trace retention failed; partial evidence retained',
  );
  return value as T;
}
