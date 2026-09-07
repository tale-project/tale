import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

import { setProjectId } from '../project/project-context';

// Seed the shared project-context singleton instead of mocking load-env —
// bun's mock.module leaks across test files in one process.
setProjectId('tale');

const dockerMock = mock();
const stopContainerMock = mock();
const removeContainerMock = mock();
const loggerWarnMock = mock();

mock.module('../docker/docker', () => ({ docker: dockerMock }));
mock.module('../docker/stop-container', () => ({
  stopContainer: stopContainerMock,
}));
mock.module('../docker/remove-container', () => ({
  removeContainer: removeContainerMock,
}));
mock.module('../../utils/logger', () => ({
  info: mock(),
  error: mock(),
  warn: loggerWarnMock,
  step: mock(),
  success: mock(),
  header: mock(),
  blank: mock(),
  debug: mock(),
}));

const { retireLegacyBackendTier } = await import('./retire-legacy-backend');

/**
 * The regression this guards: before the application tier became a colour,
 * `backend-api` and `backend-worker` were stateful singletons in the
 * deployment's OWN compose project. They now live inside each colour's
 * project — so on the first deploy across that change, the new colour comes
 * up, the old colour is torn down by its project label, and the pre-upgrade
 * singletons belong to neither. Left alone they keep running on the old
 * image, keep answering the shared `backend-api` alias, and keep consuming
 * the same job queue.
 */
const ok = { success: true, stdout: '', stderr: '', exitCode: 0 };

function legacyPs(services: Record<string, string[]>) {
  dockerMock.mockImplementation((...args: string[]) => {
    if (args[0] !== 'ps') return Promise.resolve(ok);
    const argv = args.join(' ');
    for (const [service, names] of Object.entries(services)) {
      if (argv.includes(`service=${service}`)) {
        return Promise.resolve({
          ...ok,
          stdout: names
            .map((name, i) => `${name}\t${service}\t${i + 1}\trunning`)
            .join('\n'),
        });
      }
    }
    return Promise.resolve(ok);
  });
}

beforeEach(() => {
  stopContainerMock.mockResolvedValue(true);
  removeContainerMock.mockResolvedValue(true);
  legacyPs({});
});

afterEach(() => {
  dockerMock.mockReset();
  stopContainerMock.mockReset();
  removeContainerMock.mockReset();
  loggerWarnMock.mockReset();
});

describe('retireLegacyBackendTier', () => {
  test('is a no-op on a deployment that has already crossed over', async () => {
    expect(await retireLegacyBackendTier()).toBe(0);
    expect(removeContainerMock).not.toHaveBeenCalled();
  });

  test('removes the pre-upgrade singletons from the stateful project', async () => {
    const order: string[] = [];
    dockerMock.mockImplementation((...args: string[]) => {
      if (args[0] === 'network') {
        order.push(`disconnect ${String(args[3])} ${String(args[2])}`);
        return Promise.resolve(ok);
      }
      if (args[0] !== 'ps') return Promise.resolve(ok);
      const argv = args.join(' ');
      if (argv.includes('service=backend-api')) {
        return Promise.resolve({
          ...ok,
          stdout: 'tale-backend-api\tbackend-api\t1\trunning',
        });
      }
      if (argv.includes('service=backend-worker')) {
        return Promise.resolve({
          ...ok,
          stdout: 'tale-backend-worker\tbackend-worker\t1\trunning',
        });
      }
      return Promise.resolve(ok);
    });
    stopContainerMock.mockImplementation((name: string) => {
      order.push(`stop ${name}`);
      return Promise.resolve(true);
    });

    expect(await retireLegacyBackendTier()).toBe(2);
    const removed = removeContainerMock.mock.calls.map((call) =>
      String(call[0]),
    );
    expect(removed).toEqual(['tale-backend-api', 'tale-backend-worker']);
    expect(order.indexOf('disconnect tale-backend-api tale_internal')).toBe(0);
    expect(order.indexOf('disconnect tale-backend-api tale-sandbox-net')).toBe(
      1,
    );
    expect(order.indexOf('stop tale-backend-api')).toBeGreaterThan(
      order.indexOf('disconnect tale-backend-api tale-sandbox-net'),
    );
  });

  // It looks in the deployment's OWN project, never in a colour's — the
  // colours are torn down by `retireColor`, and sweeping them here would
  // remove the api that is currently serving.
  test('never addresses a colour project', async () => {
    legacyPs({ 'backend-api': ['tale-backend-api'] });

    await retireLegacyBackendTier();

    const probed = dockerMock.mock.calls
      .map((call) => call.map(String).join(' '))
      .filter((argv) => argv.startsWith('ps'));
    expect(probed.length).toBeGreaterThan(0);
    for (const argv of probed) {
      expect(argv).toContain('project=tale');
      expect(argv).not.toContain('project=tale-blue');
      expect(argv).not.toContain('project=tale-green');
    }
  });

  // Best-effort: traffic has already moved to the new colour, so failing the
  // deploy here would report a broken upgrade that isn't one — but a
  // container left answering the alias on the old image has to be shouted
  // about, not swallowed.
  test('warns and keeps going when one cannot be removed', async () => {
    legacyPs({ 'backend-api': ['tale-backend-api'] });
    removeContainerMock.mockResolvedValue(false);

    expect(await retireLegacyBackendTier()).toBe(0);
    expect(String(loggerWarnMock.mock.calls[0]?.[0])).toContain(
      'remove it by hand',
    );
  });
});
