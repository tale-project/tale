import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { CliError } from '../../../../utils/fail';
import {
  consumingReadWarning,
  CRASH_TAIL_LABEL,
  crashReport,
  crashTail,
  readInstanceLogs,
  stoppedAfterCrashes,
} from './logs';
import {
  seedStackInstance,
  verbsFixture,
  type VerbsFixture,
} from './verbs-fixture';

let fixture: VerbsFixture;

beforeEach(() => {
  fixture = verbsFixture();
});
afterEach(() => {
  fixture.remove();
});

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

function collect() {
  const lines: string[] = [];
  const warnings: string[] = [];
  return {
    lines,
    warnings,
    onLine: (line: string) => lines.push(line),
    warn: (line: string) => warnings.push(line),
  };
}

describe('tale logs on Incus', () => {
  test('a running console is refused without --consume, and nothing is read', async () => {
    seedStackInstance(fixture.fake, 'api').consoleLog = 'one\ntwo\n';
    const error = await refusal(
      readInstanceLogs(fixture.context, 'api', { follow: false }, () => {}),
    );
    expect(error).toBeInstanceOf(CliError);
    expect(error.message).toContain('takes the lines it shows');
    expect(fixture.fake.seen('GET /1.0/instances/api/console')).toEqual([]);
  });

  test('--consume warns in one line, then reads what the console hands out', async () => {
    seedStackInstance(fixture.fake, 'api').consoleLog = 'one\r\ntwo\nthree';
    const out = collect();
    expect(
      await readInstanceLogs(
        fixture.context,
        'api',
        { follow: false, consume: true, tail: 2 },
        out.onLine,
        { warn: out.warn },
      ),
    ).toBe(0);
    expect(out.warnings).toEqual([consumingReadWarning('api')]);
    expect(out.lines).toEqual(['two', 'three']);
    // The read took them.
    expect(fixture.fake.instances.get('api')?.consoleLog).toBe('');
  });

  test('a stopped console is read freely, and stays', async () => {
    seedStackInstance(fixture.fake, 'api', { status: 'Stopped' }).consoleLog =
      'last words\n';
    for (let read = 0; read < 2; read += 1) {
      const out = collect();
      await readInstanceLogs(
        fixture.context,
        'api',
        { follow: false },
        out.onLine,
        { warn: out.warn },
      );
      expect(out).toMatchObject({ lines: ['last words'], warnings: [] });
    }
  });

  test('--since is refused: the console keeps no times', async () => {
    seedStackInstance(fixture.fake, 'api', { status: 'Stopped' });
    const error = await refusal(
      readInstanceLogs(fixture.context, 'api', {
        follow: false,
        since: '1h',
      }),
    );
    expect(error.message).toContain('--since cannot be honoured on Incus');
  });

  test('--follow polls until the instance stops, then reads what it kept', async () => {
    const api = seedStackInstance(fixture.fake, 'api');
    api.consoleLog = 'a\nb';
    const out = collect();
    let polls = 0;
    const exitCode = await readInstanceLogs(
      fixture.context,
      'api',
      { follow: true, consume: true },
      out.onLine,
      {
        warn: out.warn,
        pollMs: 1,
        sleep: async () => {
          polls += 1;
          if (polls === 1) api.consoleLog = 'c\nd\n';
          if (polls === 2) {
            api.consoleLog = 'e\n';
            api.status = 'Stopped';
          }
        },
      },
    );
    expect(exitCode).toBe(0);
    expect(out.lines).toEqual(['a', 'bc', 'd', 'e']);
    expect(polls).toBe(2);
  });

  test('a missing instance exits 1', async () => {
    const stderr = collect();
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      stderr.lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(
        await readInstanceLogs(fixture.context, 'gone', { follow: false }),
      ).toBe(1);
    } finally {
      process.stderr.write = original;
    }
    expect(stderr.lines.join('')).toContain('There is no instance gone.');
  });
});

describe('the crash report', () => {
  test('an instance stopped while wanted running stopped after repeated crashes', () => {
    expect(
      stoppedAfterCrashes('Stopped', { 'user.tale.want': 'running' }),
    ).toBe(true);
    expect(
      stoppedAfterCrashes('Stopped', { 'user.tale.want': 'stopped' }),
    ).toBe(false);
    expect(
      stoppedAfterCrashes('Running', { 'user.tale.want': 'running' }),
    ).toBe(false);
  });

  test('its tail is the stopped console, labelled as what Incus kept; a running one is never read', async () => {
    seedStackInstance(fixture.fake, 'worker', {
      status: 'Stopped',
    }).consoleLog = 'boot\npanic: x\n';
    expect(await crashTail(fixture.context, 'worker', 1)).toEqual({
      label: CRASH_TAIL_LABEL,
      lines: ['panic: x'],
    });
    expect(CRASH_TAIL_LABEL).toBe('the last console lines Incus kept');
    seedStackInstance(fixture.fake, 'api').consoleLog = 'running\n';
    expect(await crashTail(fixture.context, 'api')).toBeNull();
    expect(fixture.fake.instances.get('api')?.consoleLog).toBe('running\n');
  });

  test('the report names an instance boot.autorestart gave up on, with its tail', async () => {
    seedStackInstance(fixture.fake, 'worker', {
      status: 'Stopped',
    }).consoleLog = 'panic: x\n';
    seedStackInstance(fixture.fake, 'stopped', {
      status: 'Stopped',
      config: { 'user.tale.want': 'stopped' },
    });
    expect(await crashReport(fixture.context, 'worker')).toEqual({
      status: 'stopped after repeated crashes',
      tail: { label: CRASH_TAIL_LABEL, lines: ['panic: x'] },
    });
    expect(await crashReport(fixture.context, 'stopped')).toBeNull();
    expect(await crashReport(fixture.context, 'gone')).toBeNull();
  });
});
