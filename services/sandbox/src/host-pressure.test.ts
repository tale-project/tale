import { describe, expect, spyOn, test } from 'bun:test';

import {
  HostPressureSampler,
  PRESSURE_RING_MS,
  PRESSURE_SAMPLE_MS,
} from './host-pressure.ts';

const psi = (avg10: string) =>
  `some avg10=${avg10} avg60=0.00 avg300=0.00 total=1\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n`;

/** A host whose files read as `files` (a throwing entry fails its read). */
function sampler(scenario: {
  local?: () => boolean;
  files?: Partial<Record<string, () => string>>;
  now?: () => number;
}) {
  const reads: string[] = [];
  const files: Record<string, () => string> = {
    '/proc/loadavg': () => '2.50 1.00 0.50 3/400 999\n',
    '/sys/devices/system/cpu/online': () => '0-3\n',
    '/proc/pressure/cpu': () => psi('12.50'),
    '/proc/pressure/memory': () => psi('0.40'),
    '/proc/pressure/io': () => psi('3.00'),
    ...scenario.files,
  };
  let judged = 0;
  const instance = new HostPressureSampler({
    isLocal: () => {
      judged += 1;
      return Promise.resolve(scenario.local?.() ?? true);
    },
    readFile: (path) => {
      reads.push(path);
      const read = files[path];
      return read === undefined
        ? Promise.reject(new Error(`ENOENT: ${path}`))
        : Promise.resolve().then(read);
    },
    ...(scenario.now === undefined ? {} : { now: scenario.now }),
  });
  return { instance, reads, judged: () => judged };
}

describe('HostPressureSampler', () => {
  test('reads the load, the CPUs online and the three pressure stall shares of a local host', async () => {
    const now = 1_000_000;
    const { instance, reads } = sampler({ now: () => now });
    expect(instance.describesHost()).toBeNull();
    await instance.sample();
    expect(instance.describesHost()).toBe(true);
    expect(instance.readings()).toEqual([
      {
        atMs: now,
        load1: 2.5,
        cpus: 4,
        cpuPsi: 12.5,
        memoryPsi: 0.4,
        ioPsi: 3,
      },
    ]);
    expect(reads.toSorted()).toEqual([
      '/proc/loadavg',
      '/proc/pressure/cpu',
      '/proc/pressure/io',
      '/proc/pressure/memory',
      '/sys/devices/system/cpu/online',
    ]);
  });

  test('keeps two minutes of readings, oldest first', async () => {
    let now = 1_000_000;
    const { instance } = sampler({ now: () => now });
    for (let step = 0; step < 30; step += 1) {
      await instance.sample();
      now += PRESSURE_SAMPLE_MS;
    }
    now -= PRESSURE_SAMPLE_MS;
    const kept = instance.readings();
    expect(kept.at(-1)?.atMs).toBe(now);
    expect(kept[0]?.atMs).toBe(now - PRESSURE_RING_MS);
    expect(kept.length).toBe(PRESSURE_RING_MS / PRESSURE_SAMPLE_MS + 1);
    // A reading ages out of the ring even before the next sample lands.
    const oldest = kept[0]?.atMs ?? 0;
    now += 1;
    expect(instance.readings()[0]?.atMs).toBe(oldest + PRESSURE_SAMPLE_MS);
    expect(instance.readings()).toHaveLength(kept.length - 1);
  });

  test('a host that is not the Docker host is never read, and its ring stays empty', async () => {
    const { instance, reads } = sampler({ local: () => false });
    await instance.sample();
    expect(instance.describesHost()).toBe(false);
    expect(instance.readings()).toEqual([]);
    expect(reads).toEqual([]);
  });

  test('a host that stops reading as the Docker host drops what was read before', async () => {
    let now = 1_000_000;
    let local = true;
    const { instance } = sampler({ local: () => local, now: () => now });
    await instance.sample();
    now += PRESSURE_SAMPLE_MS;
    await instance.sample();
    expect(instance.readings()).toHaveLength(2);
    local = false;
    now += PRESSURE_SAMPLE_MS;
    await instance.sample();
    expect(instance.readings()).toEqual([]);
  });

  test('a signal that cannot be read is unknown, never 0, and said once', async () => {
    let now = 1_000_000;
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { instance } = sampler({
        now: () => now,
        files: {
          '/proc/pressure/memory': () => {
            throw new Error('EOPNOTSUPP');
          },
          // A kernel booted with psi=0 keeps the file without the line.
          '/proc/pressure/io': () => '',
          '/sys/devices/system/cpu/online': () => 'garbage',
        },
      });
      await instance.sample();
      now += PRESSURE_SAMPLE_MS;
      await instance.sample();
      const last = instance.readings().at(-1);
      expect(last).toMatchObject({
        load1: 2.5,
        cpus: null,
        cpuPsi: 12.5,
        memoryPsi: null,
        ioPsi: null,
      });
      const said = warn.mock.calls.map((call) => String(call[0]));
      expect(
        said.filter((line) => line.includes('memory pressure')),
      ).toHaveLength(1);
      expect(said.filter((line) => line.includes('I/O pressure'))).toHaveLength(
        1,
      );
      expect(said.filter((line) => line.includes('online CPUs'))).toHaveLength(
        1,
      );
    } finally {
      warn.mockRestore();
    }
  });

  test('concurrent samples share one read', async () => {
    const { instance, judged } = sampler({});
    await Promise.all([
      instance.sample(),
      instance.sample(),
      instance.sample(),
    ]);
    expect(judged()).toBe(1);
    expect(instance.readings()).toHaveLength(1);
  });

  test('a clock that went back leaves no reading stamped after the newest', async () => {
    let now = 1_000_000;
    const { instance } = sampler({ now: () => now });
    await instance.sample();
    now -= 60_000;
    await instance.sample();
    expect(instance.readings().map((reading) => reading.atMs)).toEqual([now]);
  });

  test('tells its listeners after each reading, and survives one that throws', async () => {
    let now = 1_000_000;
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { instance } = sampler({ now: () => now });
      let heard = 0;
      instance.onReading(() => {
        throw new Error('listener broke');
      });
      const remove = instance.onReading(() => {
        heard += 1;
      });
      await instance.sample();
      now += PRESSURE_SAMPLE_MS;
      await instance.sample();
      remove();
      now += PRESSURE_SAMPLE_MS;
      await instance.sample();
      expect(heard).toBe(2);
      expect(instance.readings()).toHaveLength(3);
      expect(
        warn.mock.calls.filter((call) =>
          String(call[0]).includes('listener failed'),
        ),
      ).toHaveLength(3);
    } finally {
      warn.mockRestore();
    }
  });

  test('started, it samples at once', async () => {
    const { instance } = sampler({});
    instance.start();
    try {
      await instance.sample();
      expect(instance.readings()).toHaveLength(1);
    } finally {
      instance.stop();
    }
  });
});
