// What the workspace suites share (design 7.2, 7.3, 15.5): a Tale workspace
// whose tale.json declares the Incus runtime, deployed by released builds of
// the CLI — `tale init`, `tale incus bootstrap`, `tale deploy` — on the same
// node as the managed deployment `harness.ts` keeps, in a project, bridge and
// address block of its own.
//
// A workspace deploys the release its CLI was built as (a development build
// deploys `latest`), and a rollback needs two releases a patch apart, so the
// harness builds the CLI twice from the checkout, as releases N and N+1, and
// the lab's registry carries the stack's images under both versions
// (`images.sh` with TAG=<version>). Each suite builds on the workspace the
// ones before it left, so it runs alone as well as after the others.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  cli,
  cliEnvironment,
  expectCode,
  incus,
  jsonOf,
  loadLab,
  logRun,
  until,
  type LabConfig,
  type Run,
} from './harness';
import { judge } from './load';

// ---- the workspace lab ------------------------------------------------------------

/** The workspace's part of the lab, from the environment. */
export interface WorkspaceLab {
  lab: LabConfig;
  /** Its Incus project and bridge (at most 15 characters). */
  name: string;
  network: { subnet: string; gateway: string; block: string };
  sessions: string;
  /** Releases N and N+1: a patch apart, so a rollback may cross them. */
  releases: readonly [string, string];
  /** The directory `tale init` made. */
  dir: string;
}

const NAME = /^[a-z][a-z0-9-]{0,12}[a-z0-9]$/;
const CIDR = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const RELEASE = /^0\.([5-9]|[1-9][0-9]+)\.(0|[1-9][0-9]*)$/;

/**
 * The workspace lab from `environment`. The defaults sit beside the managed
 * stack's in the CI lab: `<name>-ws` on 10.22.0.0/22, sessions on
 * 10.23.0.0/24, releases 0.5.901 and 0.5.902.
 */
export function loadWorkspace(
  environment: Record<string, string | undefined> = process.env,
): WorkspaceLab {
  const lab = loadLab(environment);
  const value = (name: string, fallback: string, pattern: RegExp): string => {
    const found = environment[name];
    const chosen = found === undefined || found === '' ? fallback : found;
    if (!pattern.test(chosen))
      throw new Error(
        `${name} is ${JSON.stringify(chosen)}, which the lab cannot use.`,
      );
    return chosen;
  };
  const name = value('TALE_E2E_WS_NAME', `${lab.name.slice(0, 11)}-ws`, NAME);
  const [first, second, ...rest] = value(
    'TALE_E2E_RELEASES',
    '0.5.901,0.5.902',
    /^[0-9.]+,[0-9.]+$/,
  ).split(',');
  if (
    first === undefined ||
    second === undefined ||
    rest.length > 0 ||
    !RELEASE.test(first) ||
    !RELEASE.test(second)
  )
    throw new Error('TALE_E2E_RELEASES must name two releases, X.Y.Z each.');
  const [major, minor] = first.split('.');
  const [nextMajor, nextMinor, nextPatch] = second.split('.');
  if (
    major !== nextMajor ||
    minor !== nextMinor ||
    Number(nextPatch) <= Number(first.split('.')[2])
  )
    throw new Error(
      'TALE_E2E_RELEASES: the second release must be a later patch of the first.',
    );
  return {
    lab,
    name,
    network: {
      subnet: value('TALE_E2E_WS_SUBNET', '10.22.0.0/22', CIDR),
      gateway: value('TALE_E2E_WS_GATEWAY', '10.22.0.1', IPV4),
      block: value('TALE_E2E_WS_BLOCK', '10.22.1.0/24', CIDR),
    },
    sessions: value('TALE_E2E_WS_SESSIONS', '10.23.0.0/24', CIDR),
    releases: [first, second],
    dir: join(lab.dir, 'workspace', name),
  };
}

/** The host the workspace serves; the edge routes by it. */
const hostOf = (w: WorkspaceLab) => `${w.name}.lab.invalid`;

// ---- the release CLIs -------------------------------------------------------------

/** Where the CLI built as `version` lives. */
const releaseBinary = (w: WorkspaceLab, version: string) =>
  join(w.lab.dir, 'cli', version, 'tale');

/**
 * The CLI of this checkout, compiled as release `version`: the build
 * `build:host` makes, with the package's version replaced while it is
 * bundled. Built once per run.
 */
async function releaseCli(w: WorkspaceLab, version: string): Promise<string> {
  const outfile = releaseBinary(w, version);
  if (existsSync(outfile)) return outfile;
  mkdirSync(join(w.lab.dir, 'cli', version), { recursive: true });
  const root = join(w.lab.repo, 'tools/cli');
  const manifest = JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8'),
  ) as Record<string, unknown>;
  const built = await Bun.build({
    entrypoints: [join(root, 'src/index.ts')],
    compile: { outfile },
    define: { TALE_COMPILED: 'true' },
    plugins: [
      {
        name: 'release-version',
        setup(build) {
          build.onLoad(
            { filter: /[\\/]tools[\\/]cli[\\/]package\.json$/ },
            () => ({
              loader: 'json',
              contents: JSON.stringify({ ...manifest, version }),
            }),
          );
        },
      },
    ],
  });
  if (!built.success || !existsSync(outfile))
    throw new Error(
      `The CLI did not build as ${version}:\n${built.logs.map(String).join('\n')}`,
    );
  chmodSync(outfile, 0o755);
  return outfile;
}

/** Both release CLIs, built. */
export async function releaseClis(w: WorkspaceLab): Promise<void> {
  for (const version of w.releases) await releaseCli(w, version);
}

/** What every workspace run of the CLI adds to its environment: the
 * release CLIs never align themselves to the workspace's recorded version
 * (that would download a published release). */
const RELEASE_ENVIRONMENT = { TALE_ALIGNED: '1' } as const;

/** Run release `release` (0 = N, 1 = N+1) of the CLI in the workspace. */
export function tale(
  w: WorkspaceLab,
  args: readonly string[],
  options: {
    release?: 0 | 1;
    prefix?: readonly string[];
    timeoutMs?: number;
    input?: string;
  } = {},
): Run {
  const binary = releaseBinary(w, w.releases[options.release ?? 0]);
  if (!existsSync(binary))
    throw new Error(`Build the release CLIs first (releaseClis): ${binary}`);
  return cli(w.lab, args, {
    binary,
    cwd: existsSync(w.dir) ? w.dir : w.lab.dir,
    env: RELEASE_ENVIRONMENT,
    ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
    ...(options.input === undefined ? {} : { input: options.input }),
  });
}

export interface KilledRun extends Run {
  /** Whether the harness killed it, and what it saw then. */
  killed: string | null;
}

/**
 * Run the CLI in the background and kill it (SIGKILL: no handler runs) the
 * first time `killWhen` names a reason, which it is asked every `pollMs`.
 * A run that ends first is handed back as it ended.
 */
export async function taleKilled(
  w: WorkspaceLab,
  args: readonly string[],
  killWhen: () => string | null,
  options: { release?: 0 | 1; pollMs?: number; timeoutMs?: number } = {},
): Promise<KilledRun> {
  const binary = releaseBinary(w, w.releases[options.release ?? 0]);
  const started = performance.now();
  const child = spawn(binary, [...args], {
    cwd: w.dir,
    env: { ...cliEnvironment(w.lab), ...RELEASE_ENVIRONMENT },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const ended = new Promise<number>((resolve) =>
    child.on('close', (code) => resolve(code ?? -1)),
  );
  let killed: string | null = null;
  const exit: { code?: number } = {};
  void ended.then((value) => (exit.code = value));
  const deadline = started + (options.timeoutMs ?? 45 * 60_000);
  while (exit.code === undefined) {
    if (killed === null) {
      let reason: string | null = null;
      try {
        reason = killWhen();
      } catch (error) {
        // A journal read that races its writer's rename: ask again.
        console.warn('taleKilled: the kill check failed once:', error);
      }
      if (reason !== null || performance.now() > deadline) {
        killed = reason ?? 'the run took too long';
        child.kill('SIGKILL');
      }
    }
    await Bun.sleep(options.pollMs ?? 20);
  }
  const run: KilledRun = {
    args: [...args],
    code: exit.code,
    stdout,
    stderr,
    ms: Math.round(performance.now() - started),
    killed,
  };
  logRun(w.lab, run, killed === null ? '' : ` (killed: ${killed})`);
  return run;
}

// ---- the workspace, made once ------------------------------------------------------

/** `tale init` of the workspace with release N, the lab's registry declared
 * as ghcr.io's mirror, two replicas of each switched role, and the edge
 * serving the lab's host behind an external terminator. Once. */
function initialised(w: WorkspaceLab): void {
  if (existsSync(join(w.dir, 'tale.json'))) return;
  const { lab } = w;
  mkdirSync(join(lab.dir, 'workspace'), { recursive: true, mode: 0o700 });
  chmodSync(lab.dir, 0o700);
  expectCode(
    tale(w, [
      'init',
      w.dir,
      '--yes',
      '--runtime',
      'incus',
      '--incus-endpoint',
      lab.endpoint,
      '--incus-project',
      w.name,
      '--incus-pool',
      lab.pool,
      '--incus-network',
      w.name,
      '--incus-subnet',
      w.network.subnet,
      '--incus-gateway',
      w.network.gateway,
      '--incus-block',
      w.network.block,
      '--incus-sessions-subnet',
      w.sessions,
      '--incus-ingress',
      'routed',
    ]),
    0,
  );
  const declaration = join(w.dir, 'tale.json');
  const project = JSON.parse(readFileSync(declaration, 'utf8')) as {
    runtime: { incus: Record<string, unknown> };
  };
  project.runtime.incus = {
    ...project.runtime.incus,
    ...(lab.dockerMirror === '' ? {} : { registryMirror: lab.dockerMirror }),
    registryMirrors: { 'ghcr.io': lab.registry },
  };
  writeFileSync(declaration, `${JSON.stringify(project, null, 2)}\n`);
  setEnv(w, {
    HOST: hostOf(w),
    SITE_URL: `https://${hostOf(w)}`,
    TLS_MODE: 'external',
    TALE_PLATFORM_REPLICAS: '2',
    TALE_BACKEND_API_REPLICAS: '2',
  });
}

/** Set `values` in the workspace's `.env`, replacing a line that names one. */
export function setEnv(w: WorkspaceLab, values: Record<string, string>): void {
  const file = join(w.dir, '.env');
  const kept = (existsSync(file) ? readFileSync(file, 'utf8') : '')
    .split('\n')
    .filter(
      (line) =>
        line !== '' &&
        !Object.keys(values).some((name) => line.startsWith(`${name}=`)),
    );
  writeFileSync(
    file,
    `${[...kept, ...Object.entries(values).map(([name, value]) => `${name}=${value}`)].join('\n')}\n`,
    { mode: 0o600 },
  );
}

/** The node made ready for the workspace by `tale incus bootstrap`, once. */
function workspaceBootstrapped(w: WorkspaceLab): void {
  initialised(w);
  if (existsSync(join(w.dir, '.tale', 'incus', 'client.key'))) return;
  expectCode(
    tale(w, ['incus', 'bootstrap', '--workspace', w.dir, '--yes'], {
      prefix: w.lab.root,
    }),
    0,
  );
}

/** The colour the workspace serves on, or null before its first deploy. */
export function colourOf(w: WorkspaceLab): 'blue' | 'green' | null {
  const file = join(w.dir, '.tale', 'deployment-color');
  if (!existsSync(file)) return null;
  const colour = readFileSync(file, 'utf8').trim();
  return colour === 'blue' || colour === 'green' ? colour : null;
}

/** Release N deployed and serving, once. */
export async function workspaceDeployed(w: WorkspaceLab): Promise<void> {
  await releaseClis(w);
  workspaceBootstrapped(w);
  if (colourOf(w) === null)
    expectCode(tale(w, ['deploy', '--yes', '--skip-backup']), 0);
  await serving(w);
}

// ---- the node, as the administrator reads it ---------------------------------------

export interface WorkspaceInstance {
  name: string;
  status: string;
  service: string;
  colour: string | null;
  version: string | null;
  address: string | null;
  uuid: string;
  config: Record<string, string>;
}

/** The workspace's instances as the administrator sees them. */
export function workspaceInstances(w: WorkspaceLab): WorkspaceInstance[] {
  const listed = JSON.parse(
    incus(w.lab, ['list', '--project', w.name, '--format', 'json']).stdout,
  ) as {
    name: string;
    status: string;
    config: Record<string, string>;
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
    service: instance.config['user.tale.service'] ?? instance.name,
    colour: instance.config['user.tale.colour'] ?? null,
    version: instance.config['user.tale.version'] ?? null,
    address:
      instance.state?.network?.eth0?.addresses?.find(
        (address) => address.family === 'inet',
      )?.address ?? null,
    uuid: instance.config['volatile.uuid'] ?? '',
    config: instance.config,
  }));
}

/** The one instance of `service` (a singleton or stateful service). */
export function instanceOf(
  w: WorkspaceLab,
  service: string,
): WorkspaceInstance {
  const found = workspaceInstances(w).filter(
    (instance) => instance.service === service,
  );
  if (found.length !== 1)
    throw new Error(
      `The workspace holds ${found.length} instances of ${service}.`,
    );
  return found[0] as WorkspaceInstance;
}

/** The replicas of a switched role in `colour`, in name order. */
export function replicasOf(
  w: WorkspaceLab,
  service: string,
  colour: string,
): WorkspaceInstance[] {
  return workspaceInstances(w)
    .filter(
      (instance) => instance.service === service && instance.colour === colour,
    )
    .sort((left, right) =>
      left.name.localeCompare(right.name, 'en', { numeric: true }),
    );
}

/** `incus exec` in a workspace instance, as the administrator. */
export function execIn(
  w: WorkspaceLab,
  instance: string,
  script: string,
  options: { user?: number } = {},
): { code: number; stdout: string; stderr: string } {
  return incus(
    w.lab,
    [
      'exec',
      instance,
      '--project',
      w.name,
      ...(options.user === undefined ? [] : ['--user', String(options.user)]),
      '--',
      'sh',
      '-c',
      script,
    ],
    { allowFailure: true },
  );
}

/** The Incus journal of the workspace, or null when there is none. */
export function journalOf(w: WorkspaceLab): {
  phase: string;
  flip?: { phase: string; promoting: string; version: string } | null;
  restorePending: {
    id: string;
    steps: Record<string, string>;
    holders: Record<string, string>;
  } | null;
} | null {
  const file = join(w.dir, '.tale', 'incus', 'runtime.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** The workspace's custom volumes, by name. */
export function volumesOf(w: WorkspaceLab): string[] {
  return (
    JSON.parse(
      incus(w.lab, [
        'storage',
        'volume',
        'list',
        w.lab.pool,
        '--project',
        w.name,
        '--format',
        'json',
      ]).stdout,
    ) as { name: string; type: string }[]
  )
    .filter((volume) => volume.type === 'custom')
    .map((volume) => volume.name)
    .sort();
}

/** What `tale status --json` reports. */
export interface StatusRow {
  service: string;
  status: string;
  version: string | null;
  admission?: string;
}
export function statusOf(w: WorkspaceLab): {
  activeColor: string | null;
  previousVersion: string | null;
  stateful: StatusRow[];
  blue: StatusRow[];
  green: StatusRow[];
  notices: string[];
} {
  return jsonOf<{
    data: ReturnType<typeof statusOf>;
  }>(expectCode(tale(w, ['--json', 'status']), 0)).data;
}

// ---- the stack's data ---------------------------------------------------------------

/** Run SQL in the workspace's application database, as the database's
 * owner over its local socket. */
function sql(w: WorkspaceLab, statement: string): string {
  const db = instanceOf(w, 'db');
  const out = execIn(
    w,
    db.name,
    `psql -v ON_ERROR_STOP=1 -At -U "\${POSTGRES_USER:-tale}" -d "\${APP_DB_NAME:-tale_app}" -c ${shellQuote(statement)}`,
  );
  if (out.code !== 0)
    throw new Error(`psql in ${db.name} exited ${out.code}: ${out.stderr}`);
  return out.stdout.trim();
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** This run's own name for a row: the workspace's data outlives a run (and
 * a restore can bring back an earlier run's rows), so each run writes rows
 * no other run wrote. */
const RUN = Date.now().toString(36);
export const label = (name: string) => `${name}-${RUN}`;

/** A row the suite writes into the database, to read it back after a
 * restore, a reset or a migration. */
export function writeMarker(w: WorkspaceLab, row: string): void {
  sql(
    w,
    `CREATE TABLE IF NOT EXISTS e2e_marker (label text PRIMARY KEY, written timestamptz NOT NULL DEFAULT now()); INSERT INTO e2e_marker (label) VALUES ('${row.replaceAll("'", "''")}') ON CONFLICT DO NOTHING`,
  );
}

/** The markers the database holds, in label order; none when the table is
 * not there. */
export function markers(w: WorkspaceLab): string[] {
  const exists = sql(w, "SELECT to_regclass('public.e2e_marker') IS NOT NULL");
  if (exists !== 't') return [];
  const listed = sql(w, 'SELECT label FROM e2e_marker ORDER BY label');
  return listed === '' ? [] : listed.split('\n');
}

// ---- through the edge ----------------------------------------------------------------

/** The edge's address on the workspace bridge. */
export function edgeOf(w: WorkspaceLab): string {
  const proxy = instanceOf(w, 'proxy');
  if (proxy.address === null) throw new Error('The edge has no address.');
  return proxy.address;
}

/** A request through the edge, as a visitor of the workspace's host makes it. */
export function viaEdge(
  w: WorkspaceLab,
  path: string,
  edge = edgeOf(w),
): { url: string; headers: Record<string, string> } {
  return {
    url: `http://${edge}${path}`,
    headers: { Host: hostOf(w), 'X-Forwarded-Proto': 'https' },
  };
}

/** Until the workspace serves through the edge: the platform's health and
 * the backend's readiness. */
export async function serving(w: WorkspaceLab, timeoutMs = 10 * 60_000) {
  await until(
    'the workspace to serve through the edge',
    async () => {
      for (const path of ['/api/health', '/api/health/ready']) {
        const target = viaEdge(w, path);
        const response = await fetch(target.url, {
          headers: target.headers,
          signal: AbortSignal.timeout(5_000),
        });
        await response.arrayBuffer();
        if (response.status !== 200) return false;
      }
      return true;
    },
    { timeoutMs, intervalMs: 2_000 },
  );
}

/** A person with an organization, signed in through the edge. */
export interface Visitor {
  cookie: string;
  organization: string;
}

/**
 * A person with an organization, signed in through the edge. The first
 * person signs up (the workspace's owner; sign-up closes after them) and is
 * kept in `<run>/visitor-<workspace>.json`; later suites sign in as them. A
 * workspace reset with `--all` forgets them, and the next person signs up
 * again. `organizationName` names the organization a suite uses.
 */
export async function visitor(
  w: WorkspaceLab,
  organizationName: string,
): Promise<Visitor> {
  const origin = `https://${hostOf(w)}`;
  const request = async (
    path: string,
    init: { body?: unknown; cookie?: string } = {},
  ) => {
    const target = viaEdge(w, path);
    return fetch(target.url, {
      method: init.body === undefined ? 'GET' : 'POST',
      headers: {
        ...target.headers,
        origin,
        ...(init.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
        ...(init.cookie === undefined ? {} : { cookie: init.cookie }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
  };
  const cookieOf = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0])
      .join('; ');
  const file = join(w.lab.dir, `visitor-${w.name}.json`);
  let person: { email: string; password: string } | null = existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as {
        email: string;
        password: string;
      })
    : null;
  let cookie = '';
  if (person !== null) {
    const signIn = await request('/api/auth/sign-in/email', { body: person });
    cookie = cookieOf(signIn);
    if (!signIn.ok || cookie === '') person = null;
  }
  if (person === null) {
    const stamp = `e2e-${Date.now()}`;
    person = {
      email: `${stamp}@lab.invalid`,
      password: `E2e-${randomBytes(12).toString('hex')}-password!`,
    };
    const signUp = await request('/api/auth/sign-up/email', {
      body: { ...person, name: 'E2E owner' },
    });
    cookie = cookieOf(signUp);
    if (!signUp.ok || cookie === '')
      throw new Error(
        `sign-up answered ${signUp.status}: ${(await signUp.text()).slice(0, 300)}`,
      );
    writeFileSync(file, `${JSON.stringify(person)}\n`, { mode: 0o600 });
  }
  const listed = await request('/api/auth/organization/list', { cookie });
  const organizations = listed.ok
    ? ((await listed.json()) as { id: string; slug: string }[])
    : [];
  const slug = `e2e-${organizationName}`;
  const known = organizations.find(
    (organization) => organization.slug === slug,
  );
  if (known !== undefined) return { cookie, organization: known.id };
  const created = await request('/api/auth/organization/create', {
    body: { name: `E2E ${organizationName}`, slug },
    cookie,
  });
  if (!created.ok)
    throw new Error(
      `organization/create answered ${created.status}: ${(await created.text()).slice(0, 300)}`,
    );
  const { id } = (await created.json()) as { id: string };
  return { cookie, organization: id };
}

// ---- streams and attributed load ------------------------------------------------------

/** One server-sent event stream through the edge. */
export interface Stream {
  label: string;
  /** Milliseconds since `epoch` it opened (answered 200), or null. */
  openedAt: number | null;
  /** When it ended, and how; null while it is open. */
  endedAt: number | null;
  ending: string | null;
  /** The serving identity the stream's response carried, when it did. */
  identity: string | null;
  events: number;
  close(): void;
}

/** Open the backend's hint stream for `who` through the edge. */
export function openStream(
  w: WorkspaceLab,
  who: Visitor,
  name: string,
  epoch: number,
  edge = edgeOf(w),
): Stream {
  const controller = new AbortController();
  const target = viaEdge(w, `/events?orgId=${who.organization}`, edge);
  const stream: Stream = {
    label: name,
    openedAt: null,
    endedAt: null,
    ending: null,
    identity: null,
    events: 0,
    close: () => controller.abort('closed by the suite'),
  };
  void (async () => {
    try {
      const response = await fetch(target.url, {
        headers: {
          ...target.headers,
          cookie: who.cookie,
          accept: 'text/event-stream',
        },
        signal: controller.signal,
      });
      if (response.status !== 200 || response.body === null) {
        stream.endedAt = performance.now() - epoch;
        stream.ending = `HTTP ${response.status}`;
        await response.arrayBuffer().catch(() => undefined);
        return;
      }
      stream.openedAt = performance.now() - epoch;
      stream.identity = response.headers.get('tale-serving-identity');
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        stream.events += new TextDecoder()
          .decode(value)
          .split('\n\n')
          .filter((chunk) => chunk.trim() !== '').length;
      }
      stream.endedAt = performance.now() - epoch;
      stream.ending = 'the server ended it';
    } catch (error) {
      stream.endedAt = performance.now() - epoch;
      stream.ending = controller.signal.aborted
        ? 'closed by the suite'
        : `dropped: ${error instanceof Error ? error.message : String(error)}`;
    }
  })();
  return stream;
}

/** One answer an attributed poller got. */
export interface Answer {
  target: string;
  /** When the request was sent, ms since the load's epoch. */
  at: number;
  status: number;
  ok: boolean;
  reason?: string;
  /** The `Tale-Serving-Identity` the answer carried. */
  identity: string | null;
  /** How long the answer took. */
  ms: number;
  /** What failed, when the request itself did. */
  error?: string;
  /** A failed answer's first bytes and the server that sent it. */
  body?: string;
  server?: string | null;
}

/**
 * Pollers through the edge that keep each answer's serving identity, so a
 * request can be attributed to the replica process that served it.
 */
export function attributedLoad(
  targets: readonly {
    name: string;
    url: string;
    headers: Record<string, string>;
  }[],
  options: { intervalMs: number; epoch: number; timeoutMs?: number },
): { answers: Answer[]; stop(): Promise<Answer[]> } {
  const answers: Answer[] = [];
  const state = { running: true };
  const poll = async (target: (typeof targets)[number]) => {
    while (state.running) {
      const at = performance.now() - options.epoch;
      let status = 0;
      let body = '';
      let identity: string | null = null;
      let error: string | undefined;
      let server: string | null = null;
      try {
        const response = await fetch(target.url, {
          headers: target.headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
        });
        status = response.status;
        identity = response.headers.get('tale-serving-identity');
        server = response.headers.get('server');
        body = (await response.text()).slice(0, 4096);
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
        body = error;
      }
      const verdict = judge(status, body);
      answers.push({
        target: target.name,
        at,
        status,
        identity,
        ms: Math.round(performance.now() - options.epoch - at),
        ...(error === undefined ? {} : { error }),
        ...(verdict.ok ? {} : { body: body.slice(0, 200), server }),
        ...verdict,
      });
      await Bun.sleep(options.intervalMs);
    }
  };
  const pollers = targets.map((target) => poll(target));
  return {
    answers,
    async stop() {
      state.running = false;
      await Promise.all(pollers);
      return [...answers].sort((left, right) => left.at - right.at);
    },
  };
}

// ---- a sandbox session that calls the backend -------------------------------------------

/**
 * The spawner's signed API, relayed through the stateful `sandbox` instance
 * (`curl` to its own port), which no flip touches: the spawner answers its
 * own stack alone (suites/sandbox.e2e.ts relays the same way). Async, so the
 * pollers keep polling while a call is under way.
 */
export function relayThroughSpawner(
  w: WorkspaceLab,
  maxSeconds = 900,
): typeof fetch {
  const spawner = instanceOf(w, 'sandbox').name;
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    url.host = '127.0.0.1:8003';
    const headers = new Headers(init.headers);
    const body = typeof init.body === 'string' ? init.body : undefined;
    const [command, ...prefix] = w.lab.incus;
    const child = Bun.spawn(
      [
        command ?? 'incus',
        ...prefix,
        'exec',
        spawner,
        '--project',
        w.name,
        '--',
        'curl',
        '-sS',
        '--max-time',
        String(maxSeconds),
        '-X',
        init.method ?? 'GET',
        '-w',
        '\n%{http_code}',
        ...[...headers].flatMap(([key, value]) => ['-H', `${key}: ${value}`]),
        ...(body === undefined ? [] : ['--data-binary', '@-']),
        url.toString(),
      ],
      { stdin: new TextEncoder().encode(body ?? ''), stdout: 'pipe' },
    );
    const stdout = await new Response(child.stdout).text();
    await child.exited;
    const split = stdout.lastIndexOf('\n');
    const status = Number(stdout.slice(split + 1));
    return new Response(stdout.slice(0, Math.max(split, 0)), {
      status: status >= 200 && status <= 599 ? status : 502,
    });
  }) as typeof fetch;
}

/** The spawner's shared token, from the workspace's `.env`. */
export function sandboxToken(w: WorkspaceLab): string {
  const line = readFileSync(join(w.dir, '.env'), 'utf8')
    .split('\n')
    .find((entry) => entry.startsWith('SANDBOX_TOKEN='));
  if (line === undefined)
    throw new Error('The workspace has no SANDBOX_TOKEN.');
  return line.slice('SANDBOX_TOKEN='.length).replace(/^'(.*)'$/, '$1');
}

/** The script a session runs to call the backend through its stable name
 * (the switch) until `/tmp/e2e-stop` appears, printing each failure. */
export const SESSION_LOAD = [
  'rm -f /tmp/e2e-stop; ok=0; fail=0',
  'while [ ! -e /tmp/e2e-stop ]; do',
  '  line=$(timeout 5 bash -c \'exec 3<>/dev/tcp/backend-api/3005 && printf "GET /ping HTTP/1.1\\r\\nHost: backend-api\\r\\nConnection: close\\r\\n\\r\\n" >&3 && head -n 1 <&3\' 2>/dev/null)',
  '  case "$line" in',
  '    *" 200 "*) ok=$((ok + 1)) ;;',
  '    *) fail=$((fail + 1)); echo "fail $(date +%s.%N) ${line:-no answer}" ;;',
  '  esac',
  '  sleep 0.1',
  'done',
  'echo "ok $ok fail $fail"',
].join('\n');

/** What a session's load printed: its counts and its failures. */
export function sessionVerdict(stdout: string): {
  ok: number;
  fail: number;
  failures: string[];
} {
  const lines = stdout.split('\n').map((line) => line.trim());
  const total = lines
    .map((line) => /^ok (\d+) fail (\d+)$/.exec(line))
    .find((match) => match !== null);
  return {
    ok: Number(total?.[1] ?? 0),
    fail: total === undefined ? -1 : Number(total[2]),
    failures: lines.filter((line) => line.startsWith('fail ')),
  };
}

// ---- a deploy, watched ---------------------------------------------------------------

/** When a run's flip reached each journaled phase, ms since `epoch`. */
export type PhaseTimes = Partial<
  Record<'starting' | 'admitted' | 'retiring', number>
>;

/**
 * Run `args` (a deploy, a rollback) to its end while the journal is read
 * every 20 ms, and hand back when its flip reached each phase.
 */
export async function watched(
  w: WorkspaceLab,
  args: readonly string[],
  epoch: number,
  options: { release?: 0 | 1 } = {},
): Promise<{ run: KilledRun; phases: PhaseTimes }> {
  const phases: PhaseTimes = {};
  const run = await taleKilled(
    w,
    args,
    () => {
      const phase = journalOf(w)?.flip?.phase;
      if (
        (phase === 'starting' ||
          phase === 'admitted' ||
          phase === 'retiring') &&
        phases[phase] === undefined
      )
        phases[phase] = performance.now() - epoch;
      return null;
    },
    options,
  );
  return { run, phases };
}

/** How long a withdrawal waits before the old colour may serve nothing new:
 * two switch health intervals (`verbs/switch.ts`), and a second of slack
 * for a request already on its way. */
export const WITHDRAWAL_WINDOW_MS = 4_000 + 1_000;

/** The rows of `tale status --json` for the live colour's replicas of `role`
 * (`platform`, or `platform #2` when there are several). */
export function liveRows(
  status: ReturnType<typeof statusOf>,
  role: string,
): StatusRow[] {
  const rows = status.activeColor === 'green' ? status.green : status.blue;
  return rows.filter(
    (row) => row.service === role || row.service.startsWith(`${role} #`),
  );
}

/** The release CLI whose version the live colour runs (0 = N, 1 = N+1). */
export function runningRelease(w: WorkspaceLab): 0 | 1 {
  const version = liveRows(statusOf(w), 'platform')[0]?.version;
  return version === w.releases[1] ? 1 : 0;
}

// ---- snapshots -----------------------------------------------------------------------

const SNAPSHOT_ID = /\b(\d{8}-\d{6}-[a-z]+)\b/g;

/** `tale backup` (with `--archive`, the archives too): the new snapshot's id. */
export function backupNow(
  w: WorkspaceLab,
  options: { archive?: boolean } = {},
): string {
  const run = expectCode(
    tale(w, ['backup', ...(options.archive === true ? ['--archive'] : [])], {
      release: runningRelease(w),
    }),
    0,
  );
  const id = /Snapshot (\d{8}-\d{6}-[a-z]+) complete/.exec(
    run.stdout + run.stderr,
  )?.[1];
  if (id === undefined)
    throw new Error(`tale backup named no snapshot:\n${run.stdout}`);
  return id;
}

/** The snapshot ids `tale restore` lists. */
export function snapshotIds(w: WorkspaceLab): string[] {
  const run = expectCode(tale(w, ['restore']), 0);
  return [
    ...new Set(
      [...(run.stdout + run.stderr).matchAll(SNAPSHOT_ID)].map(
        (match) => match[1] ?? '',
      ),
    ),
  ]
    .filter((id) => id !== '')
    .sort();
}

/** Restart an instance outside the CLI, as the administrator, without
 * blocking the pollers. */
export async function incusRestart(
  w: WorkspaceLab,
  instance: string,
): Promise<void> {
  const [command, ...prefix] = w.lab.incus;
  const child = Bun.spawn(
    [
      command ?? 'incus',
      ...prefix,
      'restart',
      instance,
      '--project',
      w.name,
      '--timeout',
      '120',
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const code = await child.exited;
  if (code !== 0)
    throw new Error(
      `incus restart ${instance} exited ${code}: ${await new Response(child.stderr).text()}`,
    );
}

/** Run the CLI without blocking: pollers and streams keep going meanwhile
 * (a synchronous run would stop them, and hide what they would see). */
export function taleAsync(
  w: WorkspaceLab,
  args: readonly string[],
  options: { release?: 0 | 1; timeoutMs?: number } = {},
): Promise<KilledRun> {
  return taleKilled(w, args, () => null, options);
}

/** Gaps longer than `maxMs` between one target's consecutive requests: a
 * load that stalled, whose silence would hide failures. */
export function stalls(answers: readonly Answer[], maxMs = 6_500): string[] {
  const last = new Map<string, number>();
  const found: string[] = [];
  for (const answer of [...answers].sort((left, right) => left.at - right.at)) {
    const before = last.get(answer.target);
    if (before !== undefined && answer.at - before > maxMs)
      found.push(
        `${answer.target}: nothing sent for ${Math.round(answer.at - before)} ms at ${Math.round(before)} ms`,
      );
    last.set(answer.target, answer.at);
  }
  return found;
}
