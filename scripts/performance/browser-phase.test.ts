import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CDPSession } from '../../packages/e2e/src/index.ts';
import { capturePhase } from './browser/phase';

test('successful action and checkpoint survive a subsequent trace-integrity failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tale-browser-phase-'));
  const prefix = join(directory, 'phase');
  const events = new EventEmitter();
  const order: string[] = [];
  const client = Object.assign(events, {
    async send(method: string) {
      order.push(method);
      if (method === 'Tracing.start')
        events.emit('Tracing.bufferUsage', { percentFull: 0.1 });
      if (method === 'Profiler.stop')
        return { profile: { nodes: [{ id: 1 }] } };
      if (method === 'Tracing.end')
        events.emit('Tracing.tracingComplete', {
          stream: 'owned',
          dataLossOccurred: true,
        });
      if (method === 'IO.read')
        return { data: '{"traceEvents":[]}', eof: true };
      return {};
    },
  }) as unknown as CDPSession;
  let observed: unknown;
  try {
    await expect(
      capturePhase(
        client,
        prefix,
        async () => ({ tFrame: 42 }),
        async (value) => {
          order.push('checkpoint');
          observed = value;
        },
      ),
    ).rejects.toThrow('Profile or trace retention failed');
    expect(observed).toEqual({ tFrame: 42 });
    expect(order.indexOf('checkpoint')).toBeLessThan(
      order.indexOf('Tracing.end'),
    );
    expect(
      JSON.parse(await readFile(`${prefix}.action.json`, 'utf8')),
    ).toMatchObject({
      status: 'action-complete',
      accepted: false,
      result: { tFrame: 42 },
    });
    const stages = JSON.parse(await readFile(`${prefix}.stages.json`, 'utf8'));
    expect(stages.bufferUsage[0].value.percentFull).toBe(0.1);
    expect(
      stages.stages.map((stage: { name: string }) => stage.name),
    ).toContain('checkpoint-complete');
    expect(events.listenerCount('Tracing.bufferUsage')).toBe(0);
    expect(
      JSON.parse(await readFile(`${prefix}.trace.json.receipt.json`, 'utf8'))
        .status,
    ).toBe('failed');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an action-failure receipt write cannot prevent protocol finalization and listener cleanup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tale-browser-phase-'));
  const prefix = join(directory, 'phase');
  const events = new EventEmitter();
  const calls: string[] = [];
  const client = Object.assign(events, {
    async send(method: string) {
      calls.push(method);
      if (method === 'Profiler.stop')
        return { profile: { nodes: [{ id: 1 }] } };
      if (method === 'Tracing.end')
        events.emit('Tracing.tracingComplete', {
          stream: 'owned',
          dataLossOccurred: false,
        });
      if (method === 'IO.read')
        return { data: '{"traceEvents":[]}', eof: true };
      return {};
    },
  }) as unknown as CDPSession;
  try {
    await writeFile(
      `${prefix}.action-failure.json`,
      'preserved existing evidence',
    );
    await expect(
      capturePhase(client, prefix, async () => {
        throw new Error('action fault');
      }),
    ).rejects.toThrow('action fault');
    expect(calls).toContain('Profiler.stop');
    expect(calls).toContain('Tracing.end');
    expect(calls).toContain('IO.close');
    expect(events.listenerCount('Tracing.bufferUsage')).toBe(0);
    expect(await readFile(`${prefix}.action-failure.json`, 'utf8')).toBe(
      'preserved existing evidence',
    );
    const stages = JSON.parse(await readFile(`${prefix}.stages.json`, 'utf8'));
    expect(stages.failure).toContain('action fault');
    expect(stages.evidenceErrors[0]).toContain('EEXIST');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
