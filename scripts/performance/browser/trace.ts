import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, writeFile } from 'node:fs/promises';

import type { CDPSession } from '../../../packages/e2e/src/index.ts';

/** Stream to disk incrementally so a failed read retains partial evidence and
 * a large trace does not consume the measured container's memory budget. */
export async function saveRawTrace(cdp: CDPSession, path: string) {
  const file = await open(path, 'wx', 0o600);
  const hash = createHash('sha256');
  const stages: { name: string; at: number }[] = [];
  const stage = (name: string) => stages.push({ name, at: Date.now() });
  let bytes = 0;
  let digest = '';
  let stream: string | undefined;
  let completionEvent:
    | {
        stream?: string;
        dataLossOccurred?: unknown;
        traceFormat?: string;
        streamCompression?: string;
      }
    | undefined;
  let failure: unknown;
  let listener: (value: NonNullable<typeof completionEvent>) => void;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const complete = new Promise<NonNullable<typeof completionEvent>>(
    (resolvePromise, reject) => {
      listener = (value) => {
        completionEvent = value;
        stage('completion-event');
        resolvePromise(value);
      };
      cdp.once('Tracing.tracingComplete', listener);
      timer = setTimeout(
        () => reject(new Error('CDP trace completion timed out')),
        15_000,
      );
    },
  );
  // Attach a rejection handler immediately while Tracing.end is in flight.
  const completion = complete.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  try {
    stage('end-requested');
    await cdp.send('Tracing.end');
    stage('end-acknowledged');
    const result = await completion;
    if ('error' in result) throw result.error;
    stream =
      typeof result.value.stream === 'string' && result.value.stream.length > 0
        ? result.value.stream
        : undefined;
    assert(
      stream && typeof result.value.dataLossOccurred === 'boolean',
      'Malformed CDP trace completion',
    );
    stage('stream-read-started');
    while (true) {
      const chunk = await cdp.send('IO.read', { handle: stream });
      const raw = Buffer.from(
        chunk.data,
        chunk.base64Encoded ? 'base64' : 'utf8',
      );
      bytes += raw.length;
      assert(
        bytes <= 512 * 1024 * 1024,
        'Raw trace exceeded its explicit evidence budget',
      );
      hash.update(raw);
      await file.writeFile(raw);
      if (chunk.eof) break;
    }
    stage('stream-read-completed');
    assert(bytes > 0, 'CDP trace stream is empty');
    // Retain bytes even when Chromium reports loss; never certify a truncated trace.
    assert.equal(
      result.value.dataLossOccurred,
      false,
      'CDP reported trace data loss',
    );
    assert(
      (result.value.traceFormat === undefined ||
        result.value.traceFormat === 'json') &&
        (result.value.streamCompression === undefined ||
          result.value.streamCompression === 'none'),
      'CDP returned an unsupported raw trace encoding',
    );
  } catch (error) {
    failure = error;
    stage('capture-failed');
  } finally {
    if (timer) clearTimeout(timer);
    cdp.off('Tracing.tracingComplete', listener!);
    const cleanup = await Promise.allSettled([
      file.close(),
      ...(stream ? [cdp.send('IO.close', { handle: stream })] : []),
    ]);
    const cleanupErrors = cleanup.flatMap((result) =>
      result.status === 'rejected' ? [String(result.reason)] : [],
    );
    if (!failure && cleanupErrors.length)
      failure = new Error(cleanupErrors.join('; '));
    stage('cleanup-settled');
    digest = hash.digest('hex');
    await writeFile(
      `${path}.receipt.json`,
      JSON.stringify(
        {
          status: failure ? 'failed' : 'complete',
          completion: completionEvent ?? null,
          stages,
          bytes,
          sha256: digest,
          error: failure ? String(failure) : undefined,
          cleanupErrors,
        },
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    );
  }
  if (failure) throw failure;
  return { bytes, sha256: digest, streamComplete: true };
}

export async function finishProfile(cdp: CDPSession, path: string) {
  const profile = await cdp.send('Profiler.stop');
  await writeFile(path, JSON.stringify(profile.profile), {
    flag: 'wx',
    mode: 0o600,
  });
  assert(profile.profile.nodes.length > 0, 'CDP CPU profile is empty');
  return { nodes: profile.profile.nodes.length };
}
