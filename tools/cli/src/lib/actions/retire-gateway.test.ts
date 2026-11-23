import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { createModuleMocks } from '../../utils/module-mock-fixture';
import { setProjectId } from '../project/project-context';
import { FakeRuntime, type FakeExecHandler } from '../runtime/fake-runtime';
import type { ExecResult } from '../runtime/types';

const infoMock = mock();
const warnMock = mock();

// Bun's module mocks are process-wide: each one is put back once this suite
// ends, so a later suite in the same process meets the real module.
const { mockModule } = createModuleMocks(import.meta.dir);
await mockModule('../../utils/logger', () => ({
  info: infoMock,
  warn: warnMock,
  error: mock(),
  debug: mock(),
  step: mock(),
  success: mock(),
  notice: mock(),
  header: mock(),
  blank: mock(),
}));

const { GATEWAY_KEYS_PATH, gatewayRetired, retireGateway } =
  await import('./retire-gateway');

/**
 * The model relay in the backend replaced the sandbox LLM gateway
 * (tale-project/tale#4942). A key the gateway minted before still settles
 * through it, so `tale deploy` takes its container away only once the live
 * backend says no such key is open, and never its volume. These cases hold
 * each answer the backend can give, and the dry run of each.
 */

const PROJECT = 'tale';
const GATEWAY = `${PROJECT}-sandbox-llm-gateway`;
const VOLUME = `${PROJECT}_llm-gateway-data`;

let fake: FakeRuntime;
/** Every control call the backend was asked, by its argv. */
let asked: string[];

/** A backend whose control door answers `answer` for the gateway's keys. */
function backendAnswers(answer: ExecResult): void {
  const handler: FakeExecHandler = (_instance, argv) => {
    const line = argv.join(' ');
    if (!line.includes(GATEWAY_KEYS_PATH)) return undefined;
    asked.push(line);
    return answer;
  };
  fake.execHandler = handler;
}

const ok = (stdout: string): ExecResult => ({
  success: true,
  stdout,
  stderr: '',
  exitCode: 0,
});

const lines = (logger: { mock: { calls: unknown[][] } }): string[] =>
  logger.mock.calls.map((call) => String(call[0]));

beforeEach(() => {
  setProjectId(PROJECT);
  fake = new FakeRuntime();
  asked = [];
  // A deployment of the earlier release: the gateway, its volume, and the
  // live colour's backend, whose control door the deploy asks.
  fake.seedInstance({
    name: GATEWAY,
    stack: PROJECT,
    service: 'sandbox-llm-gateway',
    image: 'ghcr.io/tale-project/tale/tale-sandbox-llm-gateway:0.5.95',
    mounts: [
      { kind: 'volume', source: VOLUME, target: '/app/data', readOnly: false },
    ],
  });
  fake.seedVolume(VOLUME, { 'config.db': 'the store' });
  fake.seedInstance({
    stack: `${PROJECT}-blue`,
    service: 'backend-api',
    image: 'ghcr.io/tale-project/tale/tale-platform:0.6.0',
  });
});

afterEach(() => {
  infoMock.mockReset();
  warnMock.mockReset();
});

describe('a deploy retires the model gateway', () => {
  test('once no key it minted is open: the container goes, its volume stays and is named with how to remove it', async () => {
    backendAnswers(ok('{"open":0}'));

    expect(await retireGateway({ dryRun: false, runtime: fake })).toEqual({
      outcome: 'retired',
    });

    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain(`curl -fsS -X GET`);
    expect(fake.instances.has(GATEWAY)).toBe(false);
    expect(fake.volumes.get(VOLUME)?.get('config.db')).toBe('the store');
    expect(fake.journal).toContain(`remove ${GATEWAY}`);
    expect(
      fake.journal.some((entry) => entry.startsWith('removeVolume ')),
    ).toBe(false);
    expect(lines(infoMock)).toEqual([
      `Retired the model gateway ${GATEWAY}: no key it minted is open, and the model relay in the backend serves every turn. Its volume ${VOLUME} is kept, with the keys of the providers it reached; a snapshot taken while the gateway ran restores into it. Once you no longer need it: remove the volume ${VOLUME}`,
    ]);
    expect(warnMock).not.toHaveBeenCalled();
  });

  test('while keys it minted are still open: the container stays as it is', async () => {
    backendAnswers(ok('{"open":3}'));
    const before = fake.instances.get(GATEWAY)?.id;

    expect(await retireGateway({ dryRun: false, runtime: fake })).toEqual({
      outcome: 'kept',
      open: 3,
    });

    // Neither removed, stopped nor recreated.
    expect(fake.instances.get(GATEWAY)?.id).toBe(before);
    expect(fake.instances.get(GATEWAY)?.state).toBe('running');
    expect(fake.journal.some((entry) => entry.includes(GATEWAY))).toBe(false);
    expect(lines(infoMock)).toEqual([
      `Kept the model gateway ${GATEWAY} as it is: 3 keys it minted are still open, held by turns that started before this release, sessions that still run, or an organization's deletion. A later \`tale deploy\` retires it once none is.`,
    ]);
  });

  test('one turn is said as one', async () => {
    backendAnswers(ok('{"open":1}'));

    await retireGateway({ dryRun: false, runtime: fake });

    expect(lines(infoMock)[0]).toContain(
      'as it is: 1 key it minted is still open',
    );
    expect(fake.instances.has(GATEWAY)).toBe(true);
  });

  // The first deploy of this release asks the live colour, which is still
  // the earlier release, whose backend has no such door.
  test('where the backend cannot say: the container stays as it is, and the deploy says why', async () => {
    backendAnswers({
      success: false,
      stdout: '',
      stderr: 'curl: (22) The requested URL returned error: 404\n',
      exitCode: 22,
    });

    const outcome = await retireGateway({ dryRun: false, runtime: fake });

    expect(outcome).toEqual({
      outcome: 'unanswered',
      reason: 'curl: (22) The requested URL returned error: 404',
    });
    expect(fake.instances.get(GATEWAY)?.state).toBe('running');
    expect(fake.journal.some((entry) => entry.includes(GATEWAY))).toBe(false);
    expect(lines(warnMock)).toEqual([
      `Kept the model gateway ${GATEWAY} as it is: the backend could not say whether keys it minted are still open (curl: (22) The requested URL returned error: 404). A backend from before this release has no such answer, so the first deploy of this release keeps the gateway; a later \`tale deploy\` asks again.`,
    ]);
  });

  test.each([
    [
      'a door that does not answer in time',
      { success: false, stdout: '', stderr: '', exitCode: 124 },
      'the backend did not answer within 15 s',
    ],
    [
      'an answer that is no JSON',
      ok('<html>maintenance</html>'),
      'its answer is no count of open keys',
    ],
    [
      'a count that is none',
      ok('{"open":-1}'),
      'its answer is no count of open keys',
    ],
    [
      'an answer without a count',
      ok('{"closed":0}'),
      'its answer is no count of open keys',
    ],
  ] as const)(
    'reads %s as an answer it does not have, and keeps the gateway',
    async (_name, answer, reason) => {
      backendAnswers(answer);

      expect(await retireGateway({ dryRun: false, runtime: fake })).toEqual({
        outcome: 'unanswered',
        reason,
      });
      expect(fake.instances.has(GATEWAY)).toBe(true);
    },
  );

  test('with no backend up to ask, keeps the gateway', async () => {
    backendAnswers(ok('{"open":0}'));
    const backend = fake.instances.get(`${PROJECT}-blue-backend-api-1`);
    if (backend === undefined) throw new Error('no backend');
    backend.state = 'exited';

    expect(await retireGateway({ dryRun: false, runtime: fake })).toEqual({
      outcome: 'unanswered',
      reason: 'no running backend-api container to address the control door',
    });
    expect(asked).toEqual([]);
    expect(fake.instances.has(GATEWAY)).toBe(true);
  });

  test('where no gateway is left, asks nothing and says nothing', async () => {
    fake.instances.delete(GATEWAY);
    backendAnswers(ok('{"open":0}'));

    expect(await retireGateway({ dryRun: false, runtime: fake })).toEqual({
      outcome: 'absent',
    });
    expect(asked).toEqual([]);
    expect(infoMock).not.toHaveBeenCalled();
    expect(warnMock).not.toHaveBeenCalled();
  });

  test('a container that will not go is said, with how to remove it, and its volume stays', async () => {
    backendAnswers(ok('{"open":0}'));
    fake.remove = async () => false;

    expect(await retireGateway({ dryRun: false, runtime: fake })).toEqual({
      outcome: 'not-removed',
    });
    expect(fake.volumes.has(VOLUME)).toBe(true);
    expect(lines(warnMock)).toEqual([
      `Could not retire the model gateway ${GATEWAY}, although no key it minted is open: remove the container by hand (docker rm -f ${GATEWAY}). Its volume ${VOLUME} stays either way.`,
    ]);
  });
});

describe('a dry run says which it would do, and changes nothing', () => {
  test.each([
    [
      'retire it, where no key is open',
      ok('{"open":0}'),
      'info',
      `[DRY-RUN] Would retire the model gateway ${GATEWAY}: no key it minted is open. Its volume ${VOLUME} would be kept.`,
    ],
    [
      'keep it, while turns settle',
      ok('{"open":2}'),
      'info',
      `[DRY-RUN] Would keep the model gateway ${GATEWAY} as it is: 2 keys it minted are still open, held by turns that started before this release, sessions that still run, or an organization's deletion. A later \`tale deploy\` retires it once none is.`,
    ],
    [
      'keep it, where the backend cannot say',
      {
        success: false,
        stdout: '',
        stderr: 'curl: (22) The requested URL returned error: 404',
        exitCode: 22,
      },
      'warn',
      `[DRY-RUN] Would keep the model gateway ${GATEWAY} as it is: the backend could not say whether keys it minted are still open (curl: (22) The requested URL returned error: 404). A backend from before this release has no such answer, so the first deploy of this release keeps the gateway; a later \`tale deploy\` asks again.`,
    ],
  ] as const)('%s', async (_name, answer, level, said) => {
    backendAnswers(answer);
    const before = fake.instances.get(GATEWAY)?.id;

    await retireGateway({ dryRun: true, runtime: fake });

    expect(lines(level === 'info' ? infoMock : warnMock)).toEqual([said]);
    expect(fake.instances.get(GATEWAY)?.id).toBe(before);
    expect(fake.volumes.has(VOLUME)).toBe(true);
    expect(fake.journal.some((entry) => entry.includes(GATEWAY))).toBe(false);
  });
});

/**
 * What every colour a deploy or a rollback starts tells its backend roles:
 * that the gateway is retired once its container is gone, so that the
 * backend never has to guess it from a lookup of the gone name.
 */
describe('whether a colour hears that the gateway is retired', () => {
  const NAMES = ['SANDBOX_LLM_GATEWAY_URL', 'LLM_GATEWAY_URL'] as const;
  const saved = Object.fromEntries(
    NAMES.map((name) => [name, process.env[name]]),
  );
  const setUrl = (name: (typeof NAMES)[number], value: string): void => {
    process.env[name] = value;
  };

  beforeEach(() => {
    for (const name of NAMES) delete process.env[name];
  });

  afterEach(() => {
    for (const name of NAMES) {
      const value = saved[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  test('not while its container is there, running or stopped', async () => {
    expect(await gatewayRetired(fake)).toBe(false);
    await fake.stop(GATEWAY);
    expect(await gatewayRetired(fake)).toBe(false);
  });

  test('once its container is gone', async () => {
    await fake.remove(GATEWAY);
    expect(await gatewayRetired(fake)).toBe(true);
  });

  test.each([
    'http://sandbox-llm-gateway:8080',
    'http://llm-gateway:8080/',
    '  ',
  ])(
    'once its container is gone, where .env names it by its own name (%p)',
    async (url) => {
      await fake.remove(GATEWAY);
      setUrl('SANDBOX_LLM_GATEWAY_URL', url);
      expect(await gatewayRetired(fake)).toBe(true);
    },
  );

  test('never for a gateway .env names at an address of its own, which no deploy ran', async () => {
    await fake.remove(GATEWAY);
    setUrl('SANDBOX_LLM_GATEWAY_URL', 'http://10.0.0.7:9090');
    expect(await gatewayRetired(fake)).toBe(false);
    delete process.env.SANDBOX_LLM_GATEWAY_URL;
    setUrl('LLM_GATEWAY_URL', 'http://gateway.internal:8080');
    expect(await gatewayRetired(fake)).toBe(false);
  });
});
