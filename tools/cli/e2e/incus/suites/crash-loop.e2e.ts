// crash-loop: a service that exits at once is restarted by Incus until
// `boot.autorestart` gives up, and is then reported "stopped after repeated
// crashes" with the console Incus kept (design D-24, R-09). The logs are read
// first, while it crashes, so the tail is proven after a consuming read
// (R3-32). `tale start`, which brings it back, is the workspace path's.

import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';

import {
  CRASH_TAIL_LABEL,
  crashReport,
  readInstanceLogs,
} from '../../../src/lib/runtime/incus/verbs/logs';
import {
  deployed,
  instancesOf,
  loadLab,
  record,
  removeScratch,
  scratchInstance,
  until,
  verbContext,
} from '../harness';

setDefaultTimeout(30 * 60_000);
const lab = loadLab();
const CRASHER = 'e2e-crash';

afterAll(() => removeScratch(lab, CRASHER));

describe('crash-loop', () => {
  test('a service that exits at once ends stopped, and is reported with the console Incus kept', async () => {
    deployed(lab);
    const started = performance.now();
    scratchInstance(
      lab,
      CRASHER,
      'echo "e2e crash: the service ends"; sleep 1; exit 3',
      {
        want: 'running',
        autorestart: true,
      },
    );
    const context = await verbContext(lab);

    // tale logs on the crashing service first: the read takes what it shows.
    const seen: string[] = [];
    await until(
      'the crashing console to be read',
      async () => {
        await readInstanceLogs(
          context,
          CRASHER,
          { follow: false, consume: true },
          (line) => seen.push(line),
          { warn: () => {} },
        );
        return seen.some((line) => line.includes('e2e crash'));
      },
      { timeoutMs: 120_000, intervalMs: 500 },
    );

    // Incus gives up restarting it; the instance stays stopped.
    await until(
      'Incus to stop restarting the service',
      () => {
        const crasher = instancesOf(lab).find(
          (instance) => instance.name === CRASHER,
        );
        return crasher?.status === 'Stopped' ? crasher : undefined;
      },
      { timeoutMs: 10 * 60_000, intervalMs: 2_000 },
    );
    const gaveUpMs = Math.round(performance.now() - started);
    await Bun.sleep(30_000);
    const still = instancesOf(lab).find(
      (instance) => instance.name === CRASHER,
    );
    expect(still?.status).toBe('Stopped');

    const report = await crashReport(context, CRASHER);
    record(lab, 'crash-loop', {
      gaveUpMs,
      tail: report?.tail.lines.slice(-5) ?? null,
    });
    expect(report?.status).toBe('stopped after repeated crashes');
    expect(report?.tail.label).toBe(CRASH_TAIL_LABEL);
    expect(report?.tail.lines.some((line) => line.includes('e2e crash'))).toBe(
      true,
    );
  });
});
