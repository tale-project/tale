import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, writeFile, type FileHandle } from 'node:fs/promises';

import type { CDPSession } from '../../../packages/e2e/src/index.ts';
import {
  observeTrace,
  type TraceOwner,
  type TraceCompletion,
} from './trace-session.ts';

/** Stream to disk incrementally so a failed read retains partial evidence and
 * a large trace does not consume the measured container's memory budget. */
export async function saveRawTrace(
  cdp: CDPSession,
  path: string,
  options: {
    maximumBytes?: number;
    owner?: TraceOwner;
    coverageEndAt?: number;
    completionTimeoutMs?: number;
    /** Protocol-control evidence only; never extends the success deadline. */
    lateObservationMs?: number;
    writeChunk?: (file: FileHandle, chunk: Buffer) => Promise<void>;
  } = {},
) {
  const maximumBytes = options.maximumBytes ?? 512 * 1024 * 1024;
  const completionTimeoutMs = options.completionTimeoutMs ?? 15_000;
  const lateObservationMs = options.lateObservationMs ?? 0;
  const owner = options.owner ?? observeTrace(cdp);
  const writeChunk =
    options.writeChunk ?? ((file, chunk) => file.writeFile(chunk));
  let file: FileHandle | undefined;
  const hash = createHash('sha256');
  const stages: { name: string; at: number }[] = [];
  const stage = (name: string) => stages.push({ name, at: Date.now() });
  let receivedBytes = 0;
  let bytes: number | null = 0;
  let digest: string | null = '';
  let readbackError: string | undefined;
  let stream: string | undefined;
  let completionEvent: TraceCompletion | undefined;
  let failure: unknown;
  let deadlineExceeded = false;
  try {
    assert(
      Number.isSafeInteger(maximumBytes) &&
        maximumBytes > 0 &&
        maximumBytes <= 512 * 1024 * 1024,
      'A trace budget may only tighten the fixed evidence ceiling',
    );
    assert(
      Number.isSafeInteger(completionTimeoutMs) &&
        completionTimeoutMs > 0 &&
        completionTimeoutMs <= 15_000,
      'Trace completion deadline may only tighten',
    );
    assert(
      Number.isSafeInteger(lateObservationMs) &&
        lateObservationMs >= 0 &&
        lateObservationMs <= 45_000,
      'Late evidence observation exceeds its fixed bound',
    );
    file = await open(path, 'wx', 0o600);
    stage('end-requested');
    // Timer starts before End, exactly as the established completion bound.
    const endDeadline = Date.now() + completionTimeoutMs;
    let endTimer: ReturnType<typeof setTimeout> | undefined;
    let endAcknowledged = false;
    try {
      endAcknowledged = await Promise.race([
        cdp.send('Tracing.end').then(() => {
          stage('end-acknowledged');
          return true;
        }),
        new Promise<false>((resolve) => {
          endTimer = setTimeout(() => resolve(false), completionTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(endTimer);
    }
    if (endAcknowledged)
      completionEvent = await owner.wait(Math.max(0, endDeadline - Date.now()));
    if (!completionEvent) {
      deadlineExceeded = true;
      failure = new Error('CDP trace completion timed out');
      stage('completion-deadline-failed');
      if (lateObservationMs) {
        completionEvent = await owner.wait(lateObservationMs);
        stage(
          completionEvent
            ? 'late-completion-observed'
            : 'late-observation-expired',
        );
      }
      if (!completionEvent) throw failure;
    }
    stream =
      typeof completionEvent.stream === 'string' &&
      completionEvent.stream.length > 0
        ? completionEvent.stream
        : undefined;
    assert(
      stream && typeof completionEvent.dataLossOccurred === 'boolean',
      'Malformed CDP trace completion',
    );
    stage('stream-read-started');
    while (true) {
      const chunk = await cdp.send('IO.read', { handle: stream });
      const raw = Buffer.from(
        chunk.data,
        chunk.base64Encoded ? 'base64' : 'utf8',
      );
      receivedBytes += raw.length;
      assert(
        receivedBytes <= maximumBytes,
        'Raw trace exceeded its explicit evidence budget',
      );
      await writeChunk(file, raw);
      bytes += raw.length;
      hash.update(raw);
      if (chunk.eof) break;
    }
    stage('stream-read-completed');
    assert(bytes > 0, 'CDP trace stream is empty');
    assert.equal(owner.events.length, 1, 'Duplicate CDP trace completion');
    if (options.coverageEndAt !== undefined)
      assert(
        owner.events[0]!.at >= options.coverageEndAt,
        'Trace completed before action coverage ended',
      );
    // Retain bytes even when Chromium reports loss; never certify a truncated trace.
    assert.equal(
      completionEvent.dataLossOccurred,
      false,
      'CDP reported trace data loss',
    );
    assert(
      (completionEvent.traceFormat === undefined ||
        completionEvent.traceFormat === 'json') &&
        (completionEvent.streamCompression === undefined ||
          completionEvent.streamCompression === 'none'),
      'CDP returned an unsupported raw trace encoding',
    );
  } catch (error) {
    failure ??= error;
    stage('capture-failed');
  } finally {
    const cleanup = await Promise.allSettled([
      ...(file ? [file.close()] : []),
      owner.dispose(),
    ]);
    const cleanupErrors = cleanup.flatMap((result) =>
      result.status === 'rejected'
        ? [String(result.reason)]
        : Array.isArray(result.value)
          ? result.value
          : [],
    );
    if (!failure && cleanupErrors.length)
      failure = new Error(cleanupErrors.join('; '));
    stage('cleanup-settled');
    if (!file) {
      bytes = null;
      digest = null;
    } else if (failure) {
      // A rejected write can still have written a prefix; only the actual
      // retained file can establish its byte/hash receipt after failure.
      try {
        const retainedHash = createHash('sha256');
        bytes = 0;
        for await (const chunk of createReadStream(path)) {
          bytes += chunk.length;
          retainedHash.update(chunk);
        }
        digest = retainedHash.digest('hex');
      } catch (error) {
        bytes = null;
        digest = null;
        readbackError = String(error);
      }
    } else digest = hash.digest('hex');
    await writeFile(
      `${path}.receipt.json`,
      JSON.stringify(
        {
          status: failure ? 'failed' : 'complete',
          completion: completionEvent ?? owner.events[0]?.value ?? null,
          completionEvents: owner.events,
          deadlineExceeded,
          lateObservationMs,
          coverageEndAt: options.coverageEndAt,
          stages,
          bytes,
          receivedBytes,
          sha256: digest,
          readbackError,
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
  assert(bytes !== null && digest !== null);
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
