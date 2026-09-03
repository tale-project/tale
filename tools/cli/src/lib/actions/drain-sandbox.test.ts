import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { setProjectId } from '../project/project-context';

setProjectId('tale');

const dockerMock = mock();
const isContainerRunningMock = mock();
const loggerWarnMock = mock();
const loggerInfoMock = mock();

mock.module('../docker/docker', () => ({ docker: dockerMock }));
mock.module('../docker/is-container-running', () => ({
  isContainerRunning: isContainerRunningMock,
}));
mock.module('../../utils/logger', () => ({
  info: loggerInfoMock,
  warn: loggerWarnMock,
  step: mock(),
  debug: mock(),
  error: mock(),
  success: mock(),
}));

const { controlScript, drainSandbox } = await import('./drain-sandbox');

function ok(stdout = '') {
  return { success: true, stdout, stderr: '', exitCode: 0 };
}
function fail(stderr: string) {
  return { success: false, stdout: '', stderr, exitCode: 1 };
}

/** Is this docker argv the in-container `drain` call (vs. `drain-status`)? */
function isDrainCall(args: string[]): boolean {
  return args.join(' ').includes('control-cli.ts drain;');
}

/**
 * Route the `docker` mock by argv: the drain-status call returns the per-call
 * JSON; the drain call (and anything else) succeeds with empty stdout.
 */
function arrangeDrainStatus(jsonByCall: string[]): void {
  let i = 0;
  dockerMock.mockImplementation((...args: string[]) => {
    if (args.join(' ').includes('control-cli.ts drain-status;')) {
      const json = jsonByCall[Math.min(i, jsonByCall.length - 1)];
      i += 1;
      return Promise.resolve(ok(json));
    }
    return Promise.resolve(ok());
  });
}

beforeEach(() => {
  isContainerRunningMock.mockResolvedValue(true);
});
afterEach(() => {
  dockerMock.mockReset();
  isContainerRunningMock.mockReset();
  loggerWarnMock.mockReset();
  loggerInfoMock.mockReset();
});

describe('drainSandbox', () => {
  test('dry-run never touches the container', async () => {
    await drainSandbox({ dryRun: true });
    expect(isContainerRunningMock).not.toHaveBeenCalled();
    expect(dockerMock).not.toHaveBeenCalled();
  });

  test('skips gracefully when no sandbox container is running', async () => {
    isContainerRunningMock.mockResolvedValue(false);
    await drainSandbox({ dryRun: false });
    expect(dockerMock).not.toHaveBeenCalled();
  });

  test('proceeds (warns) when the drain call itself fails', async () => {
    // The drain call fails (e.g. the signed client was refused) → warn and
    // return without polling.
    dockerMock.mockImplementation((...args: string[]) =>
      isDrainCall(args)
        ? Promise.resolve(fail('[sandbox.control] drain failed (401)'))
        : Promise.resolve(ok()),
    );
    await drainSandbox({ dryRun: false });
    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
  });

  test('drains through the signed in-container control client on the single container', async () => {
    arrangeDrainStatus(['{"inFlight":0}']);
    await drainSandbox({ dryRun: false, pollMs: 1, timeoutMs: 5_000 });
    const drainCall = dockerMock.mock.calls
      .map((c) => c.map(String))
      .find((a) => isDrainCall(a));
    expect(drainCall).toBeDefined();
    // `docker exec <container> sh -c <script>` — the script runs INSIDE the
    // container, where the spawner's SANDBOX_TOKEN already lives.
    expect(drainCall?.slice(0, 4)).toEqual([
      'exec',
      'tale-sandbox',
      'sh',
      '-c',
    ]);
    const script = drainCall?.[4] ?? '';
    expect(script).toContain('bun /app/src/control-cli.ts drain;');
    // Pre-signed-client images (open routes) still drain via the legacy curl.
    expect(script).toContain(
      'curl -fsS -X POST http://localhost:8003/v1/drain;',
    );
  });

  test('never carries the shared secret in argv (the client reads it in-container)', async () => {
    const prev = process.env.SANDBOX_TOKEN;
    process.env.SANDBOX_TOKEN = 'leak-canary-0123456789abcdef';
    try {
      arrangeDrainStatus(['{"inFlight":0}']);
      await drainSandbox({ dryRun: false, pollMs: 1, timeoutMs: 5_000 });
      for (const call of dockerMock.mock.calls) {
        expect(call.map(String).join(' ')).not.toContain('leak-canary');
        expect(call.map(String).join(' ')).not.toContain('SANDBOX_TOKEN');
      }
    } finally {
      if (prev === undefined) delete process.env.SANDBOX_TOKEN;
      else process.env.SANDBOX_TOKEN = prev;
    }
  });

  test('the in-container control scripts are valid sh', () => {
    const sh = Bun.which('sh');
    if (!sh) return; // no POSIX shell on this host (Windows dev box)
    for (const command of ['drain', 'drain-status'] as const) {
      const check = Bun.spawnSync([sh, '-n', '-c', controlScript(command)]);
      expect(check.exitCode).toBe(0);
    }
  });

  test('drain-status rides the same signed client', async () => {
    arrangeDrainStatus(['{"inFlight":0}']);
    await drainSandbox({ dryRun: false, pollMs: 1, timeoutMs: 5_000 });
    const statusCall = dockerMock.mock.calls
      .map((c) => c.map(String))
      .find((a) => a.join(' ').includes('control-cli.ts drain-status;'));
    expect(statusCall?.slice(0, 4)).toEqual([
      'exec',
      'tale-sandbox',
      'sh',
      '-c',
    ]);
    expect(statusCall?.[4]).toContain(
      'curl -fsS -X GET http://localhost:8003/v1/drain-status;',
    );
  });

  test('returns as soon as inFlight reaches 0', async () => {
    arrangeDrainStatus(['{"inFlight":2}', '{"inFlight":0}']);
    await drainSandbox({ dryRun: false, pollMs: 1, timeoutMs: 5_000 });
    const infoLines = loggerInfoMock.mock.calls.map((c) => String(c[0]));
    expect(infoLines.some((l) => l.includes('finished'))).toBe(true);
  });

  test('gives up and warns after the budget, leaving recreate to proceed', async () => {
    arrangeDrainStatus(['{"inFlight":1}']);
    await drainSandbox({ dryRun: false, pollMs: 1, timeoutMs: 10 });
    expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    const warn = String(loggerWarnMock.mock.calls[0]?.[0] ?? '');
    expect(warn).toContain('recreating anyway');
  });

  test('treats an unparseable drain-status as unknown and waits to the deadline', async () => {
    arrangeDrainStatus(['not json at all']);
    await drainSandbox({ dryRun: false, pollMs: 1, timeoutMs: 10 });
    const warn = String(loggerWarnMock.mock.calls[0]?.[0] ?? '');
    expect(warn).toContain('unknown');
  });
});
