import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import {
  chmod,
  cp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import { sha256 } from '../config/releases/identity';
import { inferenceRouterCompose } from '../inference/router';
import { writeDeploymentBundle } from './bundle';
import { INFERENCE_IMAGES, prepareManagedInference } from './inference';
import {
  applyManagedInference,
  observeManagedInference,
} from './inference-apply';
import { managedInferenceFixture } from './inference-test-helper';
import type { RuntimeDependencies } from './runtime-model';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
const success = (stdout = '') => ({
  success: true,
  exitCode: 0,
  stdout,
  stderr: '',
});
const environment = {
  TALE_APP_NETWORK: '0123456789abcdef',
  TALE_SECRETS_INFERENCE_API_KEY: 'synthetic-service-key-with-32-characters',
};

/** Memory-only Docker effects plus real private files. It is not a Docker or
 * ZeroTier integration proof; router HTTP/SSE behavior has its own real Caddy test. */
function fakeContainers(directory: string) {
  const compose = parse(
    readFileSync(join(directory, 'compose.yml'), 'utf8'),
  ) as ReturnType<typeof inferenceRouterCompose>;
  const overlayId = 'a'.repeat(64);
  return INFERENCE_IMAGES.map((image, index) => {
    const proxy = image.service === 'inference-router';
    return {
      Id: proxy ? 'b'.repeat(64) : overlayId,
      Name: `/north-inference-${image.service}-1`,
      Config: {
        Image: String(image.reference),
        Labels: {
          'com.docker.compose.project': 'north-inference',
          'com.docker.compose.service': image.service,
          'com.docker.compose.project.working_dir': directory,
          'com.docker.compose.container-number': '1',
          'com.docker.compose.oneoff': 'False',
          ...(proxy ? compose.services['inference-router'].labels : {}),
        } as Record<string, string>,
        Env: proxy
          ? [
              `TALE_SECRETS_INFERENCE_API_KEY=${environment.TALE_SECRETS_INFERENCE_API_KEY}`,
            ]
          : [
              `ZT_NETWORKS=${environment.TALE_APP_NETWORK}`,
              'ZT_OVERRIDE_LOCAL_CONF=true',
              'ZT_ALLOW_MANAGEMENT_FROM=',
              'ZT_PORT_MAPPING_ENABLED=false',
            ],
        Cmd: proxy ? compose.services['inference-router'].command : null,
      },
      State: { Running: true },
      HostConfig: {
        NetworkMode: proxy ? `container:${overlayId}` : 'north_internal',
        Privileged: false,
        PidMode: '',
        PortBindings: {} as Record<string, unknown>,
        ReadonlyRootfs: proxy,
        CapAdd: proxy ? null : ['CAP_NET_ADMIN'],
        CapDrop: proxy ? ['ALL'] : null,
        SecurityOpt: proxy ? ['no-new-privileges:true'] : null,
        Devices: proxy
          ? null
          : [
              {
                PathOnHost: '/dev/net/tun',
                PathInContainer: '/dev/net/tun',
                CgroupPermissions: 'rwm',
              },
            ],
      },
      NetworkSettings: {
        Networks: proxy
          ? {}
          : { north_internal: { Aliases: ['inference-overlay.local'] } },
      },
      Mounts: proxy
        ? [
            {
              Type: 'bind',
              Source: join(directory, 'Caddyfile'),
              Destination: '/etc/caddy/Caddyfile',
              RW: false,
            },
            { Type: 'tmpfs', Source: '', Destination: '/data', RW: true },
            { Type: 'tmpfs', Source: '', Destination: '/config', RW: true },
          ]
        : [
            {
              Type: 'volume',
              Name: 'north-inference_inference-overlay-identity',
              Source: `/var/lib/docker/volumes/identity-${index}/_data`,
              Destination: '/var/lib/zerotier-one',
              RW: true,
            },
          ],
    };
  });
}

async function fixture() {
  const f = await managedInferenceFixture();
  roots.push(f.root);
  await prepareManagedInference(
    f.repo,
    f.output,
    f.spec,
    f.dependencies,
    f.environment,
  );
  await mkdir(f.spec.stateDirectory, { mode: 0o700 });
  const directory = join(f.spec.stateDirectory, 'inference');
  const receiptPath = join(
    f.spec.stateDirectory,
    '.tale/inference-router.json',
  );
  const docker = {
    calls: [] as string[][],
    containers: [] as ReturnType<typeof fakeContainers>,
    volumes: [] as string[],
    volumeLabels: {
      'com.docker.compose.project': 'north-inference',
      'com.docker.compose.volume': 'inference-overlay-identity',
    },
    acceptedLoss: false,
    failValidation: false,
    invalidNetwork: false,
    pendingObserved: false,
    info: { address: '0123456789', online: true, version: '1.16.2' },
    networks: [
      {
        id: environment.TALE_APP_NETWORK,
        nwid: environment.TALE_APP_NETWORK,
        status: 'ACCESS_DENIED',
        type: 'PRIVATE',
        allowManaged: true,
        allowGlobal: false,
        allowDefault: false,
        allowDNS: false,
        assignedAddresses: [] as string[],
      },
    ],
    changeDuringObservation: false,
  };
  const dependencies: RuntimeDependencies = {
    sleep: async () => undefined,
    exec: async (command, args, options) => {
      expect(command).toBe('docker');
      expect(options?.silent).toBe(true);
      docker.calls.push(args);
      if (args[0] === 'ps')
        return success(docker.containers.map((c) => c.Id).join('\n'));
      if (args[0] === 'container' && args[1] === 'inspect')
        return success(JSON.stringify(docker.containers));
      if (args[0] === 'volume' && args[1] === 'ls')
        return success(docker.volumes.join('\n'));
      if (args[0] === 'volume' && args[1] === 'inspect')
        return success(
          JSON.stringify([
            {
              Name: args[2],
              Driver: 'local',
              Labels: docker.volumeLabels,
              Options: null,
              Scope: 'local',
              CreatedAt: '2026-09-11T00:00:00Z',
            },
          ]),
        );
      if (args[0] === 'network')
        return success(
          JSON.stringify([
            {
              Name: 'north_internal',
              Driver: 'bridge',
              Internal: false,
              Labels: {
                'com.docker.compose.project': docker.invalidNetwork
                  ? 'foreign'
                  : 'north',
                'com.docker.compose.network': 'internal',
              },
            },
          ]),
        );
      if (args[0] === 'pull' || args[0] === 'image')
        return f.dependencies.exec!(command, args, options);
      if (args[0] === 'exec') {
        if (args[2] === 'zerotier-cli') {
          if (args.at(-1) === 'info')
            return success(JSON.stringify(docker.info));
          if (args.at(-1) === 'listnetworks') {
            if (docker.changeDuringObservation)
              docker.containers[0]!.State.Running = false;
            return success(JSON.stringify(docker.networks));
          }
          throw new Error('Unexpected synthetic namespace mutation');
        }
        if (docker.failValidation)
          return {
            success: false,
            exitCode: 1,
            stdout: '',
            stderr: 'private synthetic runtime response',
          };
        return success();
      }
      if (args[0] === 'compose' && args.includes('config')) return success();
      if (args[0] === 'compose' && args.includes('up')) {
        docker.pendingObserved =
          JSON.parse(await readFile(receiptPath, 'utf8')).phase === 'pending';
        docker.containers = fakeContainers(directory);
        docker.volumes = ['north-inference_inference-overlay-identity'];
        if (docker.acceptedLoss) {
          docker.acceptedLoss = false;
          return {
            success: false,
            exitCode: 1,
            stdout: '',
            stderr: 'private response lost after acceptance',
          };
        }
        return success();
      }
      throw new Error('Unexpected synthetic Docker operation');
    },
  };
  return {
    ...f,
    docker,
    directory,
    receiptPath,
    dependencies,
    observe: () => observeManagedInference(f.output, f.spec, dependencies),
    apply: (dryRun = false) =>
      applyManagedInference(
        f.output,
        f.spec,
        dryRun,
        dependencies,
        environment,
      ),
  };
}
const writes = (calls: string[][]) =>
  calls.filter((args) => args[0] === 'pull' || args.includes('up'));

describe.skipIf(process.platform === 'win32')(
  'managed inference companion custody (synthetic Docker, POSIX files)',
  () => {
    test('writes pending before one activation and revalidates a no-op replay without opening ports', async () => {
      const f = await fixture();
      const first = await f.apply();
      expect(first.modelReadiness).toBe('no-admitted-nodes');
      expect(first.hostPorts).toEqual([]);
      expect(f.docker.pendingObserved).toBe(true);
      expect((await f.apply()).unchanged).toBe(true);
      expect(f.docker.calls.filter((args) => args.includes('up'))).toHaveLength(
        1,
      );
      expect(f.docker.calls.filter((args) => args[0] === 'exec')).toHaveLength(
        2,
      );
    }, 30000);
    test('reconciles an accepted response loss without a second Compose activation', async () => {
      const f = await fixture();
      f.docker.acceptedLoss = true;
      await expect(f.apply()).rejects.toThrow('Docker refused');
      expect(JSON.parse(await readFile(f.receiptPath, 'utf8')).phase).toBe(
        'pending',
      );
      await f.apply();
      expect(f.docker.calls.filter((args) => args.includes('up'))).toHaveLength(
        1,
      );
      expect(JSON.parse(await readFile(f.receiptPath, 'utf8')).phase).toBe(
        'ready',
      );
    }, 30000);
    test('accepts Docker canonical capabilities and the equivalent request spelling on replay', async () => {
      const f = await fixture();
      await f.apply();
      const overlay = f.docker.containers.find(
        (container) =>
          container.Config.Labels['com.docker.compose.service'] ===
          'inference-overlay',
      )!;
      expect(overlay.HostConfig.CapAdd).toEqual(['CAP_NET_ADMIN']);
      overlay.HostConfig.CapAdd = ['NET_ADMIN'];
      const count = writes(f.docker.calls).length;
      expect((await f.apply()).unchanged).toBe(true);
      expect(writes(f.docker.calls)).toHaveLength(count);
    }, 30000);
    test.each(
      (
        [
          null,
          [],
          ['CAP_NET_RAW'],
          ['CAP_CAP_NET_ADMIN'],
          ['cap_net_admin'],
          ['CAP_NET_ADMIN', 'CAP_NET_RAW'],
          ['CAP_NET_ADMIN', 'CAP_NET_ADMIN'],
          ['CAP_NET_ADMIN', 'NET_ADMIN'],
        ] satisfies (string[] | null)[]
      ).map((capabilities) => ({ capabilities })),
    )(
      'refuses missing, additional or ambiguous capabilities: %j',
      async ({ capabilities }) => {
        const f = await fixture();
        await f.apply();
        const overlay = f.docker.containers.find(
          (container) =>
            container.Config.Labels['com.docker.compose.service'] ===
            'inference-overlay',
        )!;
        overlay.HostConfig.CapAdd = capabilities;
        const count = writes(f.docker.calls).length;
        await expect(f.apply()).rejects.toThrow('capabilities');
        expect(writes(f.docker.calls)).toHaveLength(count);
      },
      30000,
    );
    test('dry-run performs no image pull, write, activation or native request', async () => {
      const f = await fixture();
      expect((await f.apply(true)).dryRun).toBe(true);
      expect(writes(f.docker.calls)).toHaveLength(0);
      expect(existsSync(f.directory)).toBe(false);
      expect(existsSync(f.receiptPath)).toBe(false);
    }, 30000);
    test('observes unauthorized and connected private membership without changing identity or files', async () => {
      const f = await fixture();
      await f.apply();
      const before = await readFile(f.receiptPath);
      const callCount = f.docker.calls.length;
      const denied = await f.observe();
      expect(denied).toMatchObject({
        kind: 'tale-inference-overlay',
        deployment: 'north',
        nodeId: '0123456789',
        networkId: environment.TALE_APP_NETWORK,
        online: true,
        status: 'ACCESS_DENIED',
        networkType: 'PRIVATE',
        assignedAddresses: [],
        networkReady: false,
      });
      f.docker.networks[0]!.status = 'OK';
      f.docker.networks[0]!.assignedAddresses = ['10.201.99.40/24'];
      const connected = await f.observe();
      expect(connected).toMatchObject({
        status: 'OK',
        networkReady: true,
        assignedAddresses: ['10.201.99.40/24'],
      });
      expect(connected.source.revision).toBe(f.revision);
      expect(await readFile(f.receiptPath)).toEqual(before);
      const calls = f.docker.calls.slice(callCount);
      expect(writes(calls)).toHaveLength(0);
      expect(
        calls.filter((call) => call[0] === 'exec').map((call) => call.slice(2)),
      ).toEqual([
        ['zerotier-cli', '-j', 'info'],
        ['zerotier-cli', '-j', 'listnetworks'],
        ['zerotier-cli', '-j', 'info'],
        ['zerotier-cli', '-j', 'listnetworks'],
      ]);
      const output = JSON.stringify(connected);
      expect(output).not.toContain(environment.TALE_SECRETS_INFERENCE_API_KEY);
      expect(output).not.toContain('container');
    }, 30000);
    test('the actual source command emits only safe enrollment data from a complete bundle and read-only Docker adapter', async () => {
      const f = await fixture();
      await f.apply();
      const selected = join(f.root, 'deployment');
      await mkdir(selected);
      await cp(f.output, join(selected, 'inference'), { recursive: true });
      await mkdir(join(selected, 'cli'));
      await writeFile(
        join(selected, 'cli/tale'),
        'synthetic executable placeholder',
        { mode: 0o700 },
      );
      await mkdir(join(selected, 'runtime'));
      await writeFile(join(selected, 'runtime/runtime.json'), '{}');
      await writeFile(join(selected, 'runtime/compose.yml'), 'services: {}');
      await writeDeploymentBundle(selected, {
        schemaVersion: 1,
        kind: 'tale-deployment',
        cli: { revision: 'c'.repeat(40), path: 'cli/tale' },
        deploymentRef: 'd'.repeat(40),
        spec: f.spec,
      });
      const bin = join(f.root, 'bin');
      await mkdir(bin);
      const data = join(f.root, 'docker-state.json');
      await writeFile(
        data,
        JSON.stringify({
          containers: f.docker.containers,
          volumes: f.docker.volumes,
          volume: {
            Name: f.docker.volumes[0],
            Driver: 'local',
            Labels: f.docker.volumeLabels,
            Options: null,
            Scope: 'local',
            CreatedAt: '2026-09-11T00:00:00Z',
          },
          info: f.docker.info,
          networks: f.docker.networks,
        }),
        { mode: 0o600 },
      );
      const adapter = join(bin, 'docker-adapter.mjs');
      await writeFile(
        adapter,
        `import {readFileSync} from 'node:fs';
const data=JSON.parse(readFileSync(${JSON.stringify(data)},'utf8'));
const args=process.argv.slice(2);
if(args[0]==='ps')console.log(data.containers.map(c=>c.Id).join('\\n'));
else if(args[0]==='container'&&args[1]==='inspect')console.log(JSON.stringify(data.containers));
else if(args[0]==='volume'&&args[1]==='ls')console.log(data.volumes.join('\\n'));
else if(args[0]==='volume'&&args[1]==='inspect')console.log(JSON.stringify([data.volume]));
else if(args[0]==='exec'&&args[2]==='zerotier-cli'&&args[3]==='-j'&&['info','listnetworks'].includes(args[4]))console.log(JSON.stringify(args[4]==='info'?data.info:data.networks));
else throw new Error('Mutation or unknown Docker operation in read-only observation');
`,
      );
      const quote = (value: string) =>
        "'" + value.replaceAll("'", "'\\''") + "'";
      await writeFile(
        join(bin, 'docker'),
        `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(adapter)} "$@"\n`,
        { mode: 0o700 },
      );
      const receipt = await readFile(f.receiptPath);
      const source = fileURLToPath(new URL('../../index.ts', import.meta.url));
      const child = Bun.spawn(
        [
          process.execPath,
          source,
          '--json',
          'deploy',
          'inference-status',
          '--bundle',
          selected,
          '--cli-ref',
          'c'.repeat(40),
          '--deployment-ref',
          'd'.repeat(40),
        ],
        {
          cwd: f.root,
          env: {
            ...process.env,
            PATH: bin + ':' + process.env.PATH,
            TALE_ALIGNED: '',
          },
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
      const result = JSON.parse(stdout);
      expect(result.command).toBe('deploy inference-status');
      expect(result.data).toMatchObject({
        nodeId: f.docker.info.address,
        networkType: 'PRIVATE',
        networkReady: false,
        bundleSha256: sha256(await readFile(join(selected, 'deployment.json'))),
        cliRef: 'c'.repeat(40),
        deploymentRef: 'd'.repeat(40),
      });
      expect(stdout).not.toContain(environment.TALE_SECRETS_INFERENCE_API_KEY);
      expect(await readFile(f.receiptPath)).toEqual(receipt);
    }, 30000);
    test.each([
      'public',
      'foreign',
      'duplicate',
      'address',
      'global-route',
      'changed',
      'pending',
      'files',
    ] as const)(
      'holds unsafe namespace observation: %s',
      async (kind) => {
        const f = await fixture();
        await f.apply();
        if (kind === 'public') f.docker.networks[0]!.type = 'PUBLIC';
        if (kind === 'foreign') f.docker.networks[0]!.id = 'f'.repeat(16);
        if (kind === 'duplicate')
          f.docker.networks.push({ ...f.docker.networks[0]! });
        if (kind === 'address')
          f.docker.networks[0]!.assignedAddresses = ['not an address'];
        if (kind === 'global-route') f.docker.networks[0]!.allowDefault = true;
        if (kind === 'changed') f.docker.changeDuringObservation = true;
        if (kind === 'pending') {
          const state = JSON.parse(await readFile(f.receiptPath, 'utf8'));
          await writeFile(
            f.receiptPath,
            JSON.stringify({ ...state, phase: 'pending' }),
          );
        }
        if (kind === 'files')
          await writeFile(join(f.directory, '.env'), 'changed');
        const count = writes(f.docker.calls).length;
        await expect(f.observe()).rejects.toThrow();
        expect(writes(f.docker.calls)).toHaveLength(count);
      },
      30000,
    );
    test('refuses an orphan identity volume before materializing any private files', async () => {
      const f = await fixture();
      f.docker.volumes = ['north-inference_inference-overlay-identity'];
      await expect(f.apply()).rejects.toThrow('Unreceipted inference volume');
      expect(writes(f.docker.calls)).toHaveLength(0);
      expect(existsSync(f.directory)).toBe(false);
    }, 30000);
    test('does not trust a missing policy label after an accepted partial activation', async () => {
      const f = await fixture();
      f.docker.acceptedLoss = true;
      await expect(f.apply()).rejects.toThrow('Docker refused');
      delete f.docker.containers[0]!.Config.Labels[
        'dev.tale.inference.policy-sha256'
      ];
      const count = writes(f.docker.calls).length;
      await expect(f.apply()).rejects.toThrow('isolation');
      expect(writes(f.docker.calls)).toHaveLength(count);
    }, 30000);
    test.each([
      'file',
      'mode',
      'network',
      'port',
      'image',
      'volume',
      'validation',
    ] as const)(
      'refuses replay drift: %s',
      async (kind) => {
        const f = await fixture();
        await f.apply();
        if (kind === 'file')
          await writeFile(join(f.directory, 'Caddyfile'), 'changed');
        if (kind === 'mode') await chmod(join(f.directory, '.env'), 0o644);
        if (kind === 'network') f.docker.invalidNetwork = true;
        if (kind === 'port')
          f.docker.containers[0]!.HostConfig.PortBindings['8081/tcp'] = [
            { HostPort: '8081' },
          ];
        if (kind === 'image')
          f.docker.containers[0]!.Config.Image = 'caddy:latest';
        if (kind === 'volume')
          f.docker.volumeLabels['com.docker.compose.project'] = 'foreign';
        if (kind === 'validation') f.docker.failValidation = true;
        const count = writes(f.docker.calls).length;
        await expect(f.apply()).rejects.toThrow();
        expect(writes(f.docker.calls)).toHaveLength(count);
      },
      30000,
    );
    test('refuses a symlinked private-state ancestor before creating a receipt outside the deployment', async () => {
      const f = await fixture();
      const outside = join(f.root, 'outside');
      await mkdir(outside, { mode: 0o700 });
      await symlink(outside, join(f.spec.stateDirectory, '.tale'));
      await expect(f.apply()).rejects.toThrow('owner');
      expect(existsSync(join(outside, 'inference-router.json'))).toBe(false);
      expect(writes(f.docker.calls)).toHaveLength(0);
    }, 30000);
    test('holds unreceipted files instead of treating their matching hash as authorization', async () => {
      const f = await fixture();
      await mkdir(f.directory, { mode: 0o700 });
      const bytes = await readFile(join(f.output, 'router/Caddyfile'));
      await writeFile(join(f.directory, 'Caddyfile'), bytes, { mode: 0o600 });
      await expect(f.apply()).rejects.toThrow('Unreceipted inference files');
      expect(sha256(await readFile(join(f.directory, 'Caddyfile')))).toBe(
        sha256(bytes),
      );
      expect(writes(f.docker.calls)).toHaveLength(0);
    }, 30000);
  },
);
