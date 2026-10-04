import assert from 'node:assert/strict';

import { parseHostCpuPressure } from './acceptance-plan.ts';

export interface HostSample {
  at: number;
  load: number[];
  cpuPressure: string;
}
export function hostQuiet(sample: HostSample) {
  assert(
    Number.isFinite(sample.at) && sample.at >= 0,
    'Invalid host sample clock',
  );
  assert(
    sample.load.length === 3 &&
      sample.load.every((value) => Number.isFinite(value) && value >= 0),
    'Malformed host load',
  );
  const pressure = parseHostCpuPressure(sample.cpuPressure);
  return {
    ...sample,
    pressure,
    quiet: sample.load[0]! < 2.5 && pressure.someAvg10 < 20,
    source: 'host loadavg() and /proc/pressure/cpu; not the slice PSI',
  };
}

export async function waitForQuietHost(
  io: {
    now: () => number;
    sample: () => Promise<HostSample>;
    save: (samples: ReturnType<typeof hostQuiet>[]) => Promise<void>;
    wait: (ms: number) => Promise<void>;
  },
  campaignDeadline: number,
) {
  const end = Math.min(io.now() + 120_000, campaignDeadline);
  const samples: ReturnType<typeof hostQuiet>[] = [];
  for (;;) {
    assert(
      io.now() < end,
      'Host never reached the fixed load/PSI precondition',
    );
    const sample = hostQuiet(await io.sample());
    samples.push(sample);
    await io.save(samples);
    assert(io.now() < end, 'Host quiet gate exhausted its fixed deadline');
    if (sample.quiet) return samples;
    await io.wait(Math.min(5000, end - io.now()));
  }
}

export interface ResourceCheckpoint {
  at: number;
  valid: boolean;
  error?: string;
  counters?: Record<string, string>;
  membership?: unknown;
}
export function assertResourceCheckpoint(
  value: ResourceCheckpoint,
  now: number,
) {
  assert(
    value.valid,
    `Resource monitor refused measurement: ${value.error ?? 'missing proof'}`,
  );
  assert(
    Number.isFinite(value.at) && now >= value.at && now - value.at <= 10_000,
    'Resource ownership/limits proof is stale',
  );
  assert(value.membership, 'Missing current resource membership proof');
  const events = value.counters?.['memory.events'];
  assert(events, 'Missing OOM counters');
  const fields = new Map(
    events
      .trim()
      .split('\n')
      .map((line): [string, string] => {
        const pieces = line.trim().split(/\s+/);
        assert(
          pieces.length === 2 && pieces[0] && pieces[1],
          'Malformed memory event row',
        );
        return [pieces[0], pieces[1]];
      }),
  );
  for (const key of ['oom', 'oom_kill', 'oom_group_kill']) {
    const raw = fields.get(key);
    // Older cgroup kernels may omit group-kill; oom and oom_kill are required.
    if (key === 'oom_group_kill' && raw === undefined) continue;
    assert(raw !== undefined && /^\d+$/.test(raw), 'Malformed OOM counter');
    assert.equal(
      Number(raw),
      0,
      'An OOM event invalidates the entire campaign',
    );
  }
  return value;
}
