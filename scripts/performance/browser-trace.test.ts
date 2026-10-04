import { afterEach, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CDPSession } from '../../packages/e2e/src/index.ts';
import { saveRawTrace } from './browser/trace';

const owned: string[] = [];
afterEach(async () => {
  for (const path of owned.splice(0))
    await rm(path, { recursive: true, force: true });
});

async function fixture(failRead = false, dataLossOccurred: unknown = false) {
  const directory = await mkdtemp(join(tmpdir(), 'tale-browser-trace-'));
  owned.push(directory);
  const calls: string[] = [];
  const transport = new EventEmitter();
  let reads = 0;
  const client = Object.assign(transport, {
    async send(method: string) {
      calls.push(method);
      if (method === 'Tracing.end')
        transport.emit('Tracing.tracingComplete', {
          stream: 'owned-stream',
          dataLossOccurred,
        });
      if (method === 'IO.read') {
        reads += 1;
        if (reads === 2 && failRead) throw new Error('trace transport lost');
        return reads === 1
          ? { data: '{"traceEvents":[', eof: false }
          : {
              data: Buffer.from('{"name":"event"}]}').toString('base64'),
              base64Encoded: true,
              eof: true,
            };
      }
      return {};
    },
  }) as unknown as CDPSession;
  return { client, path: join(directory, 'raw.trace.json'), calls };
}

test('raw CDP chunks are retained exactly, including base64 chunks', async () => {
  const f = await fixture();
  const receipt = await saveRawTrace(f.client, f.path);
  expect(JSON.parse(await readFile(f.path, 'utf8')).traceEvents).toEqual([
    { name: 'event' },
  ]);
  expect(receipt.streamComplete).toBe(true);
  expect(receipt.sha256).toHaveLength(64);
  expect(f.calls.filter((call) => call === 'IO.close')).toHaveLength(1);
});

test('a mid-stream failure keeps raw partial evidence and closes the owned stream', async () => {
  const f = await fixture(true);
  await expect(saveRawTrace(f.client, f.path)).rejects.toThrow(
    'transport lost',
  );
  expect(await readFile(f.path, 'utf8')).toBe('{"traceEvents":[');
  expect(f.calls.filter((call) => call === 'IO.close')).toHaveLength(1);
});

test('CDP data loss invalidates the capture while preserving its raw stream and receipt', async () => {
  const f = await fixture(false, true);
  await expect(saveRawTrace(f.client, f.path)).rejects.toThrow(
    'CDP reported trace data loss',
  );
  expect(JSON.parse(await readFile(f.path, 'utf8')).traceEvents).toHaveLength(
    1,
  );
  const receipt = JSON.parse(await readFile(`${f.path}.receipt.json`, 'utf8'));
  expect(receipt.completion.dataLossOccurred).toBe(true);
  expect(receipt.status).toBe('failed');
  expect(receipt.bytes).toBeGreaterThan(0);
  expect(receipt.sha256).toHaveLength(64);
  expect(f.calls.filter((call) => call === 'IO.close')).toHaveLength(1);
});

test('a malformed CDP completion cannot certify a valid raw capture', async () => {
  const f = await fixture(false, 'false');
  await expect(saveRawTrace(f.client, f.path)).rejects.toThrow(
    'Malformed CDP trace completion',
  );
  const receipt = JSON.parse(await readFile(`${f.path}.receipt.json`, 'utf8'));
  expect(receipt.completion.dataLossOccurred).toBe('false');
  expect(receipt.status).toBe('failed');
  expect(f.calls).not.toContain('IO.read');
  expect(f.calls.filter((call) => call === 'IO.close')).toHaveLength(1);
});
