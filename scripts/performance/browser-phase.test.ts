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

test('a failed trace start disposes a stream delivered during that owned attempt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tale-browser-start-'));
  const events = new EventEmitter();
  const calls: string[] = [];
  const client = Object.assign(events, {
    async send(method: string) {
      calls.push(method);
      if (method === 'Tracing.start') {
        events.emit('Tracing.tracingComplete', {
          stream: 'owned',
          dataLossOccurred: true,
        });
        throw new Error('start failed');
      }
      if (method === 'Profiler.stop')
        return { profile: { nodes: [{ id: 1 }] } };
      return {};
    },
  }) as unknown as CDPSession;
  try {
    await expect(
      capturePhase(client, join(directory, 'phase'), async () => 1),
    ).rejects.toThrow('start failed');
    expect(calls.filter((method) => method === 'IO.close')).toHaveLength(1);
    expect(events.listenerCount('Tracing.tracingComplete')).toBe(0);
    expect(events.listenerCount('Tracing.bufferUsage')).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('dialog causal mode excludes forced stacks while the legacy diagnostic stays unchanged', async () => {
  for (const mode of ['diagnostic', 'dialog'] as const) {
    const directory = await mkdtemp(join(tmpdir(), 'tale-browser-category-'));
    const events = new EventEmitter();
    let categories: string | undefined;
    const client = Object.assign(events, {
      async send(method: string, args?: { categories?: string }) {
        if (method === 'Tracing.start') categories = args?.categories;
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
      const prefix = join(directory, 'phase');
      await capturePhase(
        client,
        prefix,
        async () => 42,
        undefined,
        mode === 'dialog' ? mode : undefined,
      );
      const receipt = JSON.parse(
        await readFile(`${prefix}.stages.json`, 'utf8'),
      );
      expect(receipt.mode).toBe(mode);
      expect(receipt.categories).toBe(categories);
      if (mode === 'diagnostic')
        expect(categories).toBe(
          'devtools.timeline,blink.user_timing,disabled-by-default-devtools.timeline.stack,disabled-by-default-devtools.timeline.invalidationTracking',
        );
      else
        expect(categories).toBe(
          'devtools.timeline,blink.user_timing,v8,disabled-by-default-devtools.timeline.invalidationTracking',
        );
      expect(events.listenerCount('Tracing.tracingComplete')).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});
