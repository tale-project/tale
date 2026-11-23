/**
 * The containers of one `tale deploy` deployment, as the Docker engine lists
 * them, found the way the CLI finds them (tools/cli/src/lib/docker/
 * list-service-containers.ts): by Compose's labels. The deployment is the
 * stateful project `<id>` (db, object store, edge, spawner, egress) and one
 * project per colour of the app tier, `<id>-blue` and `<id>-green`.
 *
 * A container counts only when Compose made it: it carries a
 * `container-number` (never an image label) and is no one-off. The sandbox
 * sessions the spawner starts carry no Compose project, so they are left out
 * by construction, as the budget leaves them out.
 */

import { execFile } from 'node:child_process';

export type Colour = 'blue' | 'green';

export interface DeploymentContainer {
  /** The full container id. */
  readonly id: string;
  readonly name: string;
  /** Its Compose project. */
  readonly project: string;
  /** Its Compose service. */
  readonly service: string;
  /** The app-tier colour its project carries; null for the stateful project. */
  readonly colour: Colour | null;
  /** Its main process on the host; 0 when it has none. */
  readonly pid: number;
}

export interface EngineFacts {
  /** `systemd`, `cgroupfs` or `none`, as the engine reports it. */
  readonly cgroupDriver: string | null;
  /** 1 or 2. */
  readonly cgroupVersion: number | null;
  readonly serverVersion: string | null;
  readonly architecture: string | null;
  /** Whether the engine runs rootless (`name=rootless` among its security
   * options); null when it did not say. */
  readonly rootless: boolean | null;
}

/** Where the deployment's containers come from. */
export interface ContainerSource {
  /** The deployment's running containers now. */
  list(): Promise<DeploymentContainer[]>;
  /** What the engine says of itself. */
  engine(): Promise<EngineFacts>;
}

const PROJECT_LABEL = 'com.docker.compose.project';
const SERVICE_LABEL = 'com.docker.compose.service';
const NUMBER_LABEL = 'com.docker.compose.container-number';
const ONEOFF_LABEL = 'com.docker.compose.oneoff';

/** The `docker ps` arguments that list every running Compose container. */
export function psArguments(): string[] {
  return [
    'ps',
    '--no-trunc',
    '--filter',
    `label=${NUMBER_LABEL}`,
    '--format',
    `{{.ID}}\t{{.Names}}\t{{.Label "${PROJECT_LABEL}"}}\t{{.Label "${SERVICE_LABEL}"}}\t{{.Label "${NUMBER_LABEL}"}}\t{{.Label "${ONEOFF_LABEL}"}}`,
  ];
}

/** The colour a project of `deployment` carries, or null for its own. */
export function colourOf(deployment: string, project: string): Colour | null {
  if (project === `${deployment}-blue`) return 'blue';
  if (project === `${deployment}-green`) return 'green';
  return null;
}

/** Whether `project` is one of `deployment`'s Compose projects. */
export function belongsTo(deployment: string, project: string): boolean {
  return project === deployment || colourOf(deployment, project) !== null;
}

export interface ListedContainer {
  id: string;
  name: string;
  project: string;
  service: string;
}

/** The rows of `docker ps` that belong to the deployment. */
export function parsePs(stdout: string, deployment: string): ListedContainer[] {
  const rows: ListedContainer[] = [];
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue;
    const [id, name, project, service, number, oneoff] = line.split('\t');
    if (
      id === undefined ||
      !/^[0-9a-f]{12,64}$/.test(id) ||
      name === undefined ||
      name === '' ||
      project === undefined ||
      service === undefined ||
      service === '' ||
      !Number.isInteger(Number.parseInt(number ?? '', 10)) ||
      (oneoff ?? '').toLowerCase() === 'true' ||
      !belongsTo(deployment, project)
    ) {
      continue;
    }
    rows.push({ id, name, project, service });
  }
  return rows.sort(
    (a, b) =>
      a.project.localeCompare(b.project) ||
      a.service.localeCompare(b.service) ||
      a.name.localeCompare(b.name),
  );
}

/** `docker inspect` output (`<id>\t<pid>` per line) as a pid per id. */
export function parsePids(stdout: string): Map<string, number> {
  const pids = new Map<string, number>();
  for (const line of stdout.split('\n')) {
    const [id, pid] = line.trim().split('\t');
    const value = Number.parseInt(pid ?? '', 10);
    if (id !== undefined && id !== '' && Number.isInteger(value)) {
      pids.set(id, Math.max(0, value));
    }
  }
  return pids;
}

/** The `docker info` format `parseEngine` reads. */
export const ENGINE_FORMAT =
  '{{.CgroupDriver}}\t{{.CgroupVersion}}\t{{.ServerVersion}}\t{{.Architecture}}\t{{json .SecurityOptions}}';

/** Whether a security options list names a rootless engine. */
function rootlessOf(json: string | undefined): boolean | null {
  if (json === undefined || json === '' || json === '<no value>') return null;
  let options: unknown;
  try {
    options = JSON.parse(json);
  } catch (error) {
    console.warn(
      `[budget] the engine's security options are no JSON (${json}): ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
  if (options === null) return false;
  if (!Array.isArray(options)) return null;
  return options.some(
    (option) =>
      typeof option === 'string' && option.split(',').includes('name=rootless'),
  );
}

/** `docker info` output (`ENGINE_FORMAT`) as engine facts. */
export function parseEngine(stdout: string): EngineFacts {
  const [driver, version, server, architecture, security] = stdout
    .trim()
    .split('\t');
  const parsed = Number.parseInt(version ?? '', 10);
  const text = (value: string | undefined): string | null =>
    value === undefined || value === '' || value === '<no value>'
      ? null
      : value;
  return {
    cgroupDriver: text(driver),
    cgroupVersion: Number.isInteger(parsed) ? parsed : null,
    serverVersion: text(server),
    architecture: text(architecture),
    rootless: rootlessOf(security),
  };
}

/**
 * Why the engine cannot give the budget its reading, or null when it can: a
 * cgroup v1 engine has no `memory.stat` of v2's fields; a rootless engine, or
 * one whose cgroup driver is `none`, does not give each container a cgroup
 * of its own under the host's hierarchy, so a container's reading would be
 * another cgroup's, or missing.
 */
export function engineRefusal(engine: EngineFacts): string | null {
  if (engine.cgroupVersion !== 2) {
    return `the Docker engine runs cgroup v${engine.cgroupVersion ?? '?'}: the budget reads cgroup v2's memory.stat`;
  }
  if (engine.rootless === true) {
    return 'the Docker engine runs rootless: its containers are not read from the host’s cgroup tree, which the budget is measured on';
  }
  if (engine.cgroupDriver === 'none') {
    return 'the Docker engine’s cgroup driver is none: its containers have no cgroup of their own to read';
  }
  return null;
}

export type Run = (args: readonly string[]) => Promise<string>;

/** Run the docker CLI; resolves its stdout, rejects with its stderr. */
export function dockerRunner(binary = 'docker', timeoutMs = 15_000): Run {
  return (args) =>
    new Promise((resolve, reject) => {
      execFile(
        binary,
        [...args],
        { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error !== null) {
            reject(
              new Error(
                `${binary} ${args[0] ?? ''} failed: ${String(stderr).trim() || error.message}`,
              ),
            );
            return;
          }
          resolve(String(stdout));
        },
      );
    });
}

const PID_FORMAT = '{{.Id}}\t{{.State.Pid}}';

/**
 * The pids of the listed containers: one `docker inspect` for all of them,
 * and where that fails (`docker inspect` fails as a whole when one of its
 * containers is gone, which happens between a listing and its inspect while
 * a colour retires), one per container, each failure its own. A container
 * whose pid cannot be read keeps 0: its cgroup is then looked for at the
 * engine's conventional paths.
 */
async function readPids(
  run: Run,
  ids: readonly string[],
): Promise<Map<string, number>> {
  try {
    return parsePids(await run(['inspect', '--format', PID_FORMAT, ...ids]));
  } catch (error) {
    console.warn(
      `[budget] inspecting ${ids.length} containers at once failed, each is inspected alone: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const pids = new Map<string, number>();
  const each = await Promise.allSettled(
    ids.map(async (id) =>
      parsePids(await run(['inspect', '--format', PID_FORMAT, id])),
    ),
  );
  for (const [index, outcome] of each.entries()) {
    if (outcome.status === 'fulfilled') {
      for (const [id, pid] of outcome.value) pids.set(id, pid);
    } else {
      console.warn(
        `[budget] inspecting ${ids[index] ?? '?'} failed: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`,
      );
    }
  }
  return pids;
}

/**
 * The deployment's containers through the docker CLI. Each listing reads
 * every pid again: a container that restarted keeps its id and its cgroup,
 * but not its process.
 */
export function dockerContainerSource(
  deployment: string,
  run: Run = dockerRunner(),
): ContainerSource {
  return {
    async list() {
      const listed = parsePs(await run(psArguments()), deployment);
      if (listed.length === 0) return [];
      const pids = await readPids(
        run,
        listed.map((row) => row.id),
      );
      return listed.map((row) => ({
        id: row.id,
        name: row.name,
        project: row.project,
        service: row.service,
        colour: colourOf(deployment, row.project),
        pid: pids.get(row.id) ?? 0,
      }));
    },
    async engine() {
      return parseEngine(await run(['info', '--format', ENGINE_FORMAT]));
    },
  };
}
