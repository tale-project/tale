import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, writeFile, type FileHandle } from 'node:fs/promises';

import type { CDPSession } from '../../../packages/e2e/src/index.ts';

/** Stream to disk incrementally so a failed read retains partial evidence and
 * a large trace does not consume the measured container's memory budget. */
export async function saveRawTrace(
  cdp: CDPSession,
  path: string,
  options: {
    maximumBytes?: number;
    writeChunk?: (file: FileHandle, chunk: Buffer) => Promise<void>;
  } = {},
) {
  const maximumBytes = options.maximumBytes ?? 512 * 1024 * 1024;
  assert(
    Number.isSafeInteger(maximumBytes) &&
      maximumBytes > 0 &&
      maximumBytes <= 512 * 1024 * 1024,
    'A trace budget may only tighten the fixed evidence ceiling',
  );
  const writeChunk =
    options.writeChunk ?? ((file, chunk) => file.writeFile(chunk));
  const file = await open(path, 'wx', 0o600);
  const hash = createHash('sha256');
  const stages: { name: string; at: number }[] = [];
  const stage = (name: string) => stages.push({ name, at: Date.now() });
  let receivedBytes = 0;
  let bytes: number | null = 0;
  let digest: string | null = '';
  let readbackError: string | undefined;
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
    if (failure) {
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
          completion: completionEvent ?? null,
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
