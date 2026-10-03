import { mock } from 'bun:test';

import { Command } from 'commander';

const scenario = process.env.TALE_DEV_TEST_SCENARIO;
const stopping = scenario?.startsWith('stop');
const call = (name: string, args: unknown = []) => {
  console.log(`CALL:${JSON.stringify({ name, args })}`);
};
const result = (success = true, stdout = '', stderr = '') => ({
  success,
  stdout,
  stderr,
  exitCode: success ? 0 : 1,
});

mock.module('../../src/lib/project/find-project', () => ({
  findProject: () => (scenario === 'stop-missing' ? null : process.cwd()),
  findChildProject: () => null,
}));
mock.module('../../src/lib/project/project-context', () => ({
  getProjectId: () => 'onboarding-test',
  resolveOrAssignProjectContext: async () => call('context'),
  resolveProjectContext: async () => call('context'),
}));
mock.module('../../src/lib/config/ensure-env', () => ({
  ensureEnv: async () => {
    call('ensureEnv');
    if (stopping) throw new Error('Stop must not configure the environment');
    return { success: true };
  },
}));
mock.module('../../src/lib/actions/init', () => ({
  init: async () => {
    throw new Error('Stop must not initialize a project');
  },
}));
mock.module('../../src/lib/docker/ensure-docker', () => ({
  ensureDocker: async () => {
    call('ensureDocker');
    if (stopping) throw new Error('Stop must not install or start Docker');
    return { status: 'ready' };
  },
}));
mock.module('../../src/lib/docker/daemon-reachable', () => ({
  daemonReachable: async () => ({ reachable: true, detail: 'ready' }),
}));
mock.module('../../src/lib/docker/setup-checks', () => ({
  assertComposeAvailable: async () => call('composePreflight'),
}));
mock.module('../../src/lib/docker/ensure-sandbox-runtime-image', () => ({
  ensureSandboxRuntimeImage: async () => call('runtimeImage'),
}));
mock.module('../../src/lib/docker/ensure-image-present', () => ({
  ensureImagePresent: async () => call('appImage'),
}));
mock.module('../../src/lib/docker/ensure-config-mountpoints', () => ({
  ensureConfigMountpoints: async () => {},
}));
mock.module('../../src/lib/docker/migrate-config-volume', () => ({
  migrateConfigVolume: async () => {},
}));
mock.module('../../src/lib/docker/ensure-volumes', () => ({
  ensureVolumes: async () => true,
}));
mock.module('../../src/lib/docker/ensure-network', () => ({
  ensureNetwork: async () => true,
  ensureSandboxNetwork: async () => true,
}));
mock.module('../../src/lib/state/with-lock', () => ({
  withLock: async (
    _dir: string,
    _action: string,
    body: () => Promise<unknown>,
  ) => body(),
}));
mock.module('../../src/lib/docker/docker-compose', () => ({
  dockerCompose: async (_compose: string, args: string[]) => {
    call('compose', args);
    if (scenario?.startsWith('foreground')) await Bun.sleep(10);
    return result(
      scenario !== 'readiness-failed',
      '',
      'container backend-api is unhealthy',
    );
  },
}));
mock.module('../../src/lib/docker/get-container-health', () => ({
  getContainerHealth: async (name: string) => {
    call('health', name);
    if (scenario === 'foreground-probe-disabled' && name.endsWith('-proxy'))
      return 'none';
    return scenario === 'foreground-not-ready' && name.endsWith('-backend-api')
      ? 'starting'
      : 'healthy';
  },
}));
mock.module('../../src/lib/docker/is-container-running', () => ({
  isContainerRunning: async () => true,
}));
mock.module('../../src/lib/docker/exec', () => ({
  exec: async (command: string, args: string[]) => {
    call(command, args);
    if (args[0] === 'ps') {
      if (scenario === 'stop-list-failed')
        return result(false, '', 'daemon unavailable');
      if (scenario === 'stop-invalid-id') return result(true, '--help');
      return result(
        true,
        scenario === 'stop-empty' ? '' : 'abcdef012345\n123456abcdef',
      );
    }
    if (args[0] === 'stop' && scenario === 'stop-failed') {
      return result(false, '', 'stop failed');
    }
    return result();
  },
}));

const { createDevCommand } = await import('../../src/commands/dev');
const program = new Command().addCommand(createDevCommand());
await program.parseAsync(process.argv.slice(2), { from: 'user' });
