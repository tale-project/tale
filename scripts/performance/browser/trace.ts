import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, writeFile } from 'node:fs/promises';

import type { CDPSession } from '../../../packages/e2e/src/index.ts';

/** Stream to disk incrementally so a failed read retains partial evidence and
 * a large trace does not consume the measured container's memory budget. */
export async function saveRawTrace(cdp: CDPSession, path: string) {
  const file = await open(path, 'wx', 0o600);
  const hash = createHash('sha256');
  let bytes = 0;
  let stream: string | undefined;
  let listener: (value: { stream?: string }) => void;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const complete = new Promise<{ stream?: string }>(
    (resolvePromise, reject) => {
      listener = resolvePromise;
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
    await cdp.send('Tracing.end');
    const result = await completion;
    if ('error' in result) throw result.error;
    stream = result.value.stream;
    assert(stream, 'CDP did not return a raw trace stream');
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
    assert(bytes > 0, 'CDP trace stream is empty');
    return { bytes, sha256: hash.digest('hex'), streamComplete: true };
  } finally {
    if (timer) clearTimeout(timer);
    cdp.off('Tracing.tracingComplete', listener!);
    await file.close();
    if (stream) await cdp.send('IO.close', { handle: stream });
  }
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
