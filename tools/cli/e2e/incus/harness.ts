// What every CLI Incus suite shares: the lab, the compiled CLI it drives, the
// node's administrator, and the managed deployment the suites build on —
// prepared, bootstrapped and deployed once, whichever suite asks first, so a
// suite runs alone as well as after the others (design 15.5).
//
// The lab is a real Incus node (README.md beside this file). Nothing here runs
// without TALE_E2E_LAB=1: the suites are named *.e2e.ts, which the
// workspace's ordinary `bun test` never picks up, and `loadLab` refuses to
// start without the variable, so a run that was asked for never passes empty.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { IncusClient } from '@tale/incus/client';

import { readIncusCredentials } from '../../src/lib/runtime/incus/credentials';

// ---- the lab ----------------------------------------------------------------

/** Everything a run is told about its lab, from the environment. */
export interface LabConfig {
  /** The run's own directory: specifications, bundles, state, logs, report. */
  dir: string;
  /** The checkout the CLI and the images were built from. */
  repo: string;
  /** The compiled CLI (`bun run --filter @tale/cli build:host`). */
  cli: string;
  /** The name of every object of the run: the stack, its Incus project and
   * bridge (at most 15 characters), its state. */
  name: string;
  pool: string;
  network: { subnet: string; gateway: string; block: string };
  sessions: string;
  endpoint: string;
  /** The registry that serves ghcr.io's repositories in the lab. */
  registry: string;
  /** The host that serves docker.io's; none when empty. */
  dockerMirror: string;
  /** The release the stack is deployed at, and the one it upgrades to. */
  revision: string;
  nextRevision: string;
  /** The checkout that holds `nextRevision`. */
  nextSource: string;
  /** The version label of both releases' images. */
  version: string;
  /** Whether the specification declares a managed native client, which the
   * credential export needs (TALE_E2E_NATIVE_CLIENT=1; README.md says why it
   * is off by default). */
  nativeClient: boolean;
  /** How the administrator runs `incus` (`sudo incus` in CI). */
  incus: string[];
  /** What runs bootstrap as an administrator (`sudo -E` in CI). */
  root: string[];
}

const NAME = /^[a-z][a-z0-9-]{0,12}[a-z0-9]$/;
const SHA = /^[0-9a-f]{40}$/;
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const CIDR = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const HOST = /^[a-z0-9.-]+(:[1-9][0-9]{0,4})?$/;

function words(value: string): string[] {
  return value.split(/\s+/).filter((word) => word !== '');
}

/**
 * The lab from `environment`. The defaults are the CI lab's
 * (`.github/workflows/cli-incus-e2e.yml`): the gateway is the address
 * `services/sandbox/e2e/incus/lab.sh api` names in the server certificate.
 */
export function loadLab(
  environment: Record<string, string | undefined> = process.env,
): LabConfig {
  if (environment.TALE_E2E_LAB !== '1')
    throw new Error(
      'The CLI Incus suites drive a real Incus node: set TALE_E2E_LAB=1 on a lab (README.md beside this file).',
    );
  const value = (name: string, fallback?: string): string => {
    const found = environment[name];
    if (found !== undefined && found !== '') return found;
    if (fallback !== undefined) return fallback;
    throw new Error(`${name} is not set.`);
  };
  const check = (name: string, found: string, pattern: RegExp): string => {
    if (!pattern.test(found))
      throw new Error(
        `${name} is ${JSON.stringify(found)}, which the lab cannot use.`,
      );
    return found;
  };
  const repo = resolve(
    value('TALE_E2E_REPO', join(import.meta.dir, '../../../..')),
  );
  const dir = value('TALE_E2E_DIR');
  if (!isAbsolute(dir)) throw new Error('TALE_E2E_DIR must be absolute.');
  const gateway = check(
    'TALE_E2E_GATEWAY',
    value('TALE_E2E_GATEWAY', '10.20.0.1'),
    IPV4,
  );
  const revision = check('TALE_E2E_REVISION', value('TALE_E2E_REVISION'), SHA);
  const nextRevision = check(
    'TALE_E2E_NEXT_REVISION',
    value('TALE_E2E_NEXT_REVISION'),
    SHA,
  );
  if (nextRevision === revision)
    throw new Error(
      'TALE_E2E_NEXT_REVISION must differ from TALE_E2E_REVISION.',
    );
  return {
    dir,
    repo,
    cli: resolve(value('TALE_E2E_CLI', join(repo, 'tools/cli/dist/tale'))),
    name: check('TALE_E2E_NAME', value('TALE_E2E_NAME', 'cli-e2e'), NAME),
    pool: check('TALE_E2E_POOL', value('TALE_E2E_POOL', 'tank'), NAME),
    network: {
      subnet: check(
        'TALE_E2E_SUBNET',
        value('TALE_E2E_SUBNET', '10.20.0.0/22'),
        CIDR,
      ),
      gateway,
      block: check(
        'TALE_E2E_BLOCK',
        value('TALE_E2E_BLOCK', '10.20.1.0/25'),
        CIDR,
      ),
    },
    sessions: check(
      'TALE_E2E_SESSIONS',
      value('TALE_E2E_SESSIONS', '10.21.0.0/24'),
      CIDR,
    ),
    endpoint: value('TALE_E2E_ENDPOINT', `https://${gateway}:8443`),
    registry: check(
      'TALE_E2E_REGISTRY',
      value('TALE_E2E_REGISTRY', '127.0.0.1:5000'),
      HOST,
    ),
    dockerMirror: environment.TALE_E2E_DOCKER_MIRROR ?? 'mirror.gcr.io:443',
    revision,
    nextRevision,
    nextSource: resolve(value('TALE_E2E_NEXT_SOURCE')),
    version: check(
      'TALE_E2E_VERSION',
      value('TALE_E2E_VERSION', '0.0.0'),
      VERSION,
    ),
    nativeClient: environment.TALE_E2E_NATIVE_CLIENT === '1',
    incus: words(value('TALE_E2E_INCUS', 'incus')),
    root: words(environment.TALE_E2E_ROOT ?? ''),
  };
}

/** A value only this run knows, which no output may ever show (R-15). */
export function sentinelOf(lab: LabConfig): string {
  const file = join(lab.dir, 'sentinel');
  if (!existsSync(file)) {
    mkdirSync(lab.dir, { recursive: true });
    writeFileSync(file, `e2e-sentinel-${randomBytes(12).toString('hex')}`, {
      mode: 0o600,
    });
  }
  return readFileSync(file, 'utf8');
}

export const paths = (lab: LabConfig) => ({
  state: join(lab.dir, 'state'),
  spec: (release: 1 | 2) => join(lab.dir, `spec-${release}.json`),
  sources: join(lab.dir, 'sources.json'),
  bundle: (release: 1 | 2) => join(lab.dir, 'bundles', String(release)),
  logs: join(lab.dir, 'logs'),
  report: join(lab.dir, 'report'),
});

/** The origin the deployment answers on; the edge routes by its host. */
const originOf = (lab: LabConfig) => `https://${lab.name}.lab.invalid`;

/**
 * The managed specification of release 1 or 2: the Incus runtime on the lab,
 * Tale's registry mirrored by the lab's own, a fresh operator identity (with
 * a native client for the credential export when the lab asks for one), and
 * the run's sentinel as a declared secret.
 */
export function specOf(
  lab: LabConfig,
  release: 1 | 2,
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name: lab.name,
    stateDirectory: paths(lab).state,
    composeProject: lab.name,
    runtime: {
      revision: release === 1 ? lab.revision : lab.nextRevision,
      platform: 'linux/amd64',
      engine: 'incus',
      incus: {
        endpoint: lab.endpoint,
        project: lab.name,
        pool: lab.pool,
        network: { name: lab.name, ...lab.network },
        sessions: { subnet: lab.sessions },
        ingress: { mode: 'routed' },
        ...(lab.dockerMirror === ''
          ? {}
          : { registryMirror: lab.dockerMirror }),
        registryMirrors: { 'ghcr.io': lab.registry },
      },
    },
    origin: originOf(lab),
    tlsMode: 'external',
    sandbox: { backend: 'incus' },
    identity: {
      bootstrap: 'fresh',
      email: 'operator@lab.invalid',
      emailVerification: 'operator-attested',
      slug: 'e2e',
      name: 'E2E',
      ssoEnabled: false,
      nativeClients: lab.nativeClient
        ? [
            {
              key: 'e2e-portal',
              name: 'E2E portal',
              managed: true,
              redirectUris: ['https://portal.lab.invalid/callback'],
            },
          ]
        : [],
    },
    // The spawner's zone, as bootstrap names it by default: the operator
    // declares it (the spawner refuses to start without the four).
    environment: {
      SANDBOX_INCUS_PROJECT: { env: 'E2E_SANDBOX_INCUS_PROJECT' },
      SANDBOX_INCUS_PROFILE: { env: 'E2E_SANDBOX_INCUS_PROFILE' },
      SANDBOX_INCUS_NETWORK: { env: 'E2E_SANDBOX_INCUS_NETWORK' },
      SANDBOX_INCUS_STORAGE_POOL: { env: 'E2E_SANDBOX_INCUS_STORAGE_POOL' },
      E2E_SENTINEL: { env: 'E2E_SENTINEL' },
    },
    configs: [],
  };
}

// ---- the CLI ------------------------------------------------------------------

export interface Run {
  args: string[];
  code: number;
  stdout: string;
  stderr: string;
  ms: number;
}

/** The values behind the specification's environment references: the
 * sandbox zone and the run's sentinel. */
export function deploymentEnvironment(lab: LabConfig): Record<string, string> {
  return {
    E2E_SANDBOX_INCUS_PROJECT: `${lab.name}-sessions`,
    E2E_SANDBOX_INCUS_PROFILE: 'sandbox',
    E2E_SANDBOX_INCUS_NETWORK: `${lab.name.slice(0, 13)}-s`,
    E2E_SANDBOX_INCUS_STORAGE_POOL: lab.pool,
    E2E_SENTINEL: sentinelOf(lab),
  };
}

/** The environment every CLI run gets: no terminal, no colour, the values
 * behind the specification's references. */
export function cliEnvironment(lab: LabConfig): Record<string, string> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined &&
        !entry[0].startsWith('TALE_') &&
        !entry[0].startsWith('E2E_'),
    ),
  );
  return {
    ...inherited,
    NO_COLOR: '1',
    CI: 'true',
    ...deploymentEnvironment(lab),
  };
}

/** Keep what a CLI run said in `logs/cli.log` (the secrets suite reads
 * every line of it). */
export function logRun(lab: LabConfig, run: Run, note = ''): void {
  mkdirSync(paths(lab).logs, { recursive: true });
  appendFileSync(
    join(paths(lab).logs, 'cli.log'),
    `\n$ tale ${run.args.join(' ')}\n# exit ${run.code} after ${run.ms} ms${note}\n${run.stdout}${run.stderr}`,
  );
}

/**
 * Run the compiled CLI, keep what it said in `logs/cli.log` (the secrets
 * suite reads every line of it), and hand the result back. `prefix` runs it
 * as the administrator; `binary` runs another build of the CLI (a
 * workspace's release, `workspace.ts`), and `env` adds to its environment.
 */
export function cli(
  lab: LabConfig,
  args: readonly string[],
  options: {
    prefix?: readonly string[];
    input?: string;
    timeoutMs?: number;
    cwd?: string;
    binary?: string;
    env?: Record<string, string>;
  } = {},
): Run {
  const binary = options.binary ?? lab.cli;
  const argv = [...(options.prefix ?? []), binary, ...args];
  const started = performance.now();
  const result = spawnSync(argv[0] ?? binary, argv.slice(1), {
    cwd: options.cwd ?? lab.dir,
    env: { ...cliEnvironment(lab), ...options.env },
    encoding: 'utf8',
    input: options.input ?? '',
    timeout: options.timeoutMs ?? 45 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const run: Run = {
    args: [...args],
    code: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: `${result.stderr ?? ''}${result.error === undefined ? '' : `\n${String(result.error)}`}`,
    ms: Math.round(performance.now() - started),
  };
  logRun(lab, run);
  return run;
}

/** Throws with what the CLI said unless it ended with `code`. */
export function expectCode(run: Run, code: number): Run {
  if (run.code !== code)
    throw new Error(
      `tale ${run.args.join(' ')} exited ${run.code}, expected ${code}:\n${run.stdout.slice(-4000)}\n${run.stderr.slice(-4000)}`,
    );
  return run;
}

/** The JSON document a `--json` run printed on stdout. */
export function jsonOf<T = Record<string, unknown>>(run: Run): T {
  try {
    return JSON.parse(run.stdout) as T;
  } catch {
    throw new Error(
      `tale ${run.args.join(' ')} printed no JSON:\n${run.stdout.slice(0, 2000)}`,
    );
  }
}

// ---- the administrator --------------------------------------------------------

/** `incus` as the node's administrator. */
export function incus(
  lab: LabConfig,
  args: readonly string[],
  options: { allowFailure?: boolean; input?: string } = {},
): { code: number; stdout: string; stderr: string } {
  const [command, ...prefix] = lab.incus;
  const result = spawnSync(command ?? 'incus', [...prefix, ...args], {
    encoding: 'utf8',
    input: options.input ?? '',
    timeout: 10 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = {
    code: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
  if (out.code !== 0 && options.allowFailure !== true)
    throw new Error(
      `incus ${args.join(' ')} exited ${out.code}: ${out.stderr}`,
    );
  return out;
}

export interface NodeInstance {
  name: string;
  status: string;
  config: Record<string, string>;
  createdAt: string;
  address: string | null;
}

/** The instances of a project as the administrator sees them. */
export function instancesOf(
  lab: LabConfig,
  project = lab.name,
): NodeInstance[] {
  const listed = JSON.parse(
    incus(lab, ['list', '--project', project, '--format', 'json']).stdout,
  ) as {
    name: string;
    status: string;
    config: Record<string, string>;
    created_at: string;
    state?: {
      network?: Record<
        string,
        { addresses?: { family: string; address: string }[] }
      >;
    };
  }[];
  return listed.map((instance) => ({
    name: instance.name,
    status: instance.status,
    config: instance.config,
    createdAt: instance.created_at,
    address:
      instance.state?.network?.eth0?.addresses?.find(
        (address) => address.family === 'inet',
      )?.address ?? null,
  }));
}

/** The console an instance's console endpoint hands out (it consumes). */
export function consoleOf(lab: LabConfig, name: string): string {
  return incus(lab, ['console', name, '--project', lab.name, '--show-log'], {
    allowFailure: true,
  }).stdout;
}

/** The stack's restricted client: the certificate bootstrap made for it. */
export async function stackClient(lab: LabConfig): Promise<IncusClient> {
  return new IncusClient({
    endpoint: lab.endpoint,
    project: lab.name,
    tls: await readIncusCredentials(join(paths(lab).state, 'incus')),
    signal: () => undefined,
  });
}

// ---- waiting and reporting ----------------------------------------------------

/** Poll until `check` returns a value that is not undefined or false. */
export async function until<T>(
  what: string,
  check: () => Promise<T | undefined | false> | T | undefined | false,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = performance.now() + (options.timeoutMs ?? 120_000);
  let last: unknown;
  for (;;) {
    try {
      const value = await check();
      if (value !== undefined && value !== false) return value;
      last = undefined;
    } catch (error) {
      last = error;
    }
    if (performance.now() > deadline)
      throw new Error(
        `gave up waiting for ${what}${last === undefined ? '' : `: ${last instanceof Error ? last.message : String(last)}`}`,
      );
    await Bun.sleep(options.intervalMs ?? 1_000);
  }
}

/** Keep a suite's measurements in `report/<suite>.json`, merged. */
export function record(
  lab: LabConfig,
  suite: string,
  facts: Record<string, unknown>,
): void {
  const directory = paths(lab).report;
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${suite}.json`);
  const before = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)
    : {};
  writeFileSync(file, `${JSON.stringify({ ...before, ...facts }, null, 2)}\n`);
}

// ---- the deployment the suites share ------------------------------------------

function writeInputs(lab: LabConfig): void {
  const at = paths(lab);
  // The credentials bootstrap writes under the state directory are refused
  // below a directory another account could write to.
  mkdirSync(lab.dir, { recursive: true, mode: 0o700 });
  chmodSync(lab.dir, 0o700);
  mkdirSync(join(lab.dir, 'bundles'), { recursive: true });
  for (const release of [1, 2] as const)
    writeFileSync(
      at.spec(release),
      `${JSON.stringify(specOf(lab, release), null, 2)}\n`,
    );
  writeFileSync(
    at.sources,
    `${JSON.stringify(
      {
        [`https://github.com/tale-project/tale@${lab.revision}`]: lab.repo,
        [`https://github.com/tale-project/tale@${lab.nextRevision}`]:
          lab.nextSource,
      },
      null,
      2,
    )}\n`,
  );
}

/** A prepared bundle of `release`, made once. */
export function prepared(lab: LabConfig, release: 1 | 2): string {
  const at = paths(lab);
  const bundle = at.bundle(release);
  if (existsSync(join(bundle, 'deployment.json'))) return bundle;
  // A prepare that failed leaves its partial output for diagnosis; the next
  // attempt needs the directory gone.
  rmSync(bundle, { recursive: true, force: true });
  writeInputs(lab);
  expectCode(
    cli(lab, [
      'deploy',
      'prepare',
      '--spec',
      at.spec(release),
      '--output',
      bundle,
      '--sources-file',
      at.sources,
      // The orchestrator commit a receipt records: the lab's own revision.
      '--deployment-ref',
      lab.revision,
    ]),
    0,
  );
  return bundle;
}

/** The node made ready for the stack by `tale incus bootstrap`, once. */
export function bootstrapped(lab: LabConfig): Run | null {
  const at = paths(lab);
  if (existsSync(join(at.state, 'incus', 'client.key'))) return null;
  const bundle = prepared(lab, 1);
  return expectCode(
    cli(
      lab,
      [
        'incus',
        'bootstrap',
        '--spec',
        at.spec(1),
        '--compose',
        join(bundle, 'runtime', 'compose.yml'),
        '--yes',
      ],
      { prefix: lab.root },
    ),
    0,
  );
}

/** The receipt the managed path keeps of the stack. */
export function receiptOf(lab: LabConfig): Record<string, unknown> | null {
  const file = join(paths(lab).state, '.tale', 'runtime.json');
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)
    : null;
}

/** Release 1 deployed and ready, once. */
export function deployed(lab: LabConfig): void {
  bootstrapped(lab);
  if (receiptOf(lab)?.phase === 'ready') return;
  expectCode(cli(lab, ['deploy', '--bundle', prepared(lab, 1), '--yes']), 0);
}

/** The edge's address on the stack bridge. */
function edgeOf(lab: LabConfig): string {
  const proxy = instancesOf(lab).find((instance) => instance.name === 'proxy');
  if (proxy?.address == null)
    throw new Error('The stack has no proxy address.');
  return proxy.address;
}

/** A request through the edge, as a visitor of the origin makes it. */
export function throughEdge(
  lab: LabConfig,
  path: string,
): { url: string; headers: Record<string, string> } {
  return {
    url: `http://${edgeOf(lab)}${path}`,
    headers: {
      Host: new URL(originOf(lab)).host,
      'X-Forwarded-Proto': 'https',
    },
  };
}

/** The release the stack runs now: 2 once the managed suite upgraded it. */
export function currentRelease(lab: LabConfig): 1 | 2 {
  return receiptOf(lab)?.revision === lab.nextRevision ? 2 : 1;
}

/** What `deploy --bundle --plan-only --json` printed: the Incus plan. */
export interface PlanResource {
  id: string;
  action: string;
  effects: string[];
}
export function planOf(run: Run): {
  changed: boolean;
  resources: PlanResource[];
} {
  const document = jsonOf<{
    data?: {
      runtime?: { changed?: boolean; plan?: { resources?: PlanResource[] } };
    };
  }>(run);
  const runtime = document.data?.runtime;
  if (runtime?.plan?.resources === undefined)
    throw new Error(`tale ${run.args.join(' ')} printed no Incus plan.`);
  return {
    changed: runtime.changed ?? true,
    resources: runtime.plan.resources,
  };
}

/**
 * An instance of the suite's own in the stack's project, from the proxy image
 * the stack pulled, running `script` under `sh`: a service that talks, or one
 * that crashes. It carries a stack label of its own, so the stack's applier
 * never takes it for one of its instances.
 */
export function scratchInstance(
  lab: LabConfig,
  name: string,
  script: string,
  options: { want: 'running' | 'stopped'; autorestart: boolean },
): void {
  const images = JSON.parse(
    incus(lab, ['image', 'list', '--project', lab.name, '--format', 'json'])
      .stdout,
  ) as { aliases: { name: string }[] }[];
  const alias = images
    .flatMap((image) => image.aliases.map((entry) => entry.name))
    .find((entry) => entry.startsWith('tale-proxy-'));
  if (alias === undefined) throw new Error('The stack holds no proxy image.');
  incus(lab, ['delete', '--force', name, '--project', lab.name], {
    allowFailure: true,
  });
  incus(lab, [
    'create',
    alias,
    name,
    '--project',
    lab.name,
    '--profile',
    'tale-stack',
    '--config',
    `user.tale.stack=${lab.name}-e2e`,
    '--config',
    `user.tale.service=${name}`,
    '--config',
    `user.tale.want=${options.want}`,
    '--config',
    `boot.autorestart=${options.autorestart}`,
    '--config',
    `oci.entrypoint=/bin/sh -c ${JSON.stringify(script)}`,
    // The restricted project admits isolated containers alone.
    '--config',
    'security.idmap.isolated=true',
    // Small, so it fits beside the stack inside the project's peak limits.
    '--config',
    'limits.memory=64MiB',
    '--config',
    'limits.processes=64',
  ]);
  incus(lab, ['start', name, '--project', lab.name]);
}

/** Remove a scratch instance, whatever state it is in. */
export function removeScratch(lab: LabConfig, name: string): void {
  incus(lab, ['delete', '--force', name, '--project', lab.name], {
    allowFailure: true,
  });
}

/** The verbs' view of the stack: its restricted client and state. */
export async function verbContext(lab: LabConfig): Promise<{
  client: IncusClient;
  stack: string;
  stateRoot: string;
}> {
  return {
    client: await stackClient(lab),
    stack: lab.name,
    stateRoot: paths(lab).state,
  };
}
