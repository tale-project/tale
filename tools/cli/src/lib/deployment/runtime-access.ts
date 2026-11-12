/**
 * What the managed deployment checks ask of the container runtime, behind one
 * interface.
 *
 * Acceptance, observation, provisioning, the credential export, the spawner's
 * control, the runtime configuration and the automation protocol cutover read
 * and touch an already applied stack: they list its instances, read them and
 * their images back, run a command in one, hold a `psql` session open, copy
 * files in and out, and stop or restart an instance. They ask a
 * `RuntimeAccess` for each of these instead of building `docker` argv, so the
 * runtime underneath can change. The Docker implementation below is the only
 * place that knows the argv, and it keeps every caller's argv exactly. Its
 * readers parse Docker's JSON into the normalized `RuntimeInstance` and
 * `RuntimeImage`; each caller still states, on those records, what it demands.
 *
 * The bounds stay the caller's. A check has its own deadline, byte budget and
 * fixed failure sentences; it hands them over as a `RuntimeBudget`, which a
 * runtime applies to every call it makes for that check.
 */

import { z } from 'zod';

import { exec, type ExecResult } from '../docker/exec';
import type { RuntimeEngine, RuntimeSession } from '../runtime/types';
import { runtimeCommand, runtimeProcessEnvironment } from './runtime-command';
import type { RuntimeDependencies } from './runtime-model';

export type { ExecResult };

/** One instance read back, normalized. Every field but `id` is absent when
 *  the runtime did not report it; the caller decides what it requires. */
export interface RuntimeInstance {
  /** The runtime's identity of the instance (Docker: the container ID). */
  id: string;
  /** The content identity of the image it runs (Docker: the image ID). */
  image?: string;
  /** The reference it was created from. */
  imageReference?: string;
  restartCount?: number;
  running?: boolean;
  startedAt?: string;
  pid?: number;
  /** The state word (Docker: `running`, `exited`, …). */
  status?: string;
  dead?: boolean;
  restartPolicy?: string;
  /** The instance's metadata labels: its stack, service, replica number and
   *  one-off flag under the Compose label names, verbatim. */
  labels?: Record<string, string>;
  /** How many environment entries it has. */
  environmentSize?: number;
  /** Its `DATABASE_URL=` entries, verbatim: the one environment key a check
   *  reads (whether the backend uses the bundled database). Every other
   *  environment entry stays in the runtime. */
  databaseConnections?: string[];
  /** Its networks by name. */
  networks?: Record<string, { id?: string; address?: string }>;
  mounts?: Array<{ type?: string; source?: string; target?: string }>;
}

/** One image read back, normalized; absent fields were not reported. */
export interface RuntimeImage {
  /** The image's content identity (Docker: the image ID). */
  id?: string;
  /** `<repository>@sha256:…` references the image is known by. */
  repoDigests?: string[];
  os?: string;
  architecture?: string;
  /** Its labels; null when the image has none. */
  labels?: Record<string, string> | null;
}

/** One call's bounds, as the runtime enforces them. */
export interface RuntimeBounds {
  /** Seconds. */
  timeout: number;
  /** The call's combined output bound; unbounded when absent. */
  maxOutputBytes?: number;
}

/**
 * A check's budget for every runtime call it makes. `Tag` is the check's own
 * per-call word (a cleanup step, a longer timeout), handed back to each hook.
 */
export interface RuntimeBudget<Tag = undefined> {
  /** Asked right before a call starts; throws to refuse the call (a spent
   *  deadline). */
  bounds(tag: Tag | undefined): RuntimeBounds;
  /** The error for a call that could not complete: it did not start, timed
   *  out or overran its byte bound. Never carries the call's output. */
  failed(tag: Tag | undefined): Error | Promise<Error>;
  /** Told about every completed call; throws to refuse its result (an
   *  aggregate byte budget, a deadline passed meanwhile). */
  settled?(result: ExecResult, tag: Tag | undefined): void;
  /** The error for an unsuccessful call that does not allow failure. */
  refused(result: ExecResult, tag: Tag | undefined): Error | Promise<Error>;
}

export interface RuntimeCall<Tag = undefined> {
  /** Return an unsuccessful call's result instead of refusing it. */
  allowFailure?: boolean;
  tag?: Tag;
}

export interface RuntimeExecCall<Tag = undefined> extends RuntimeCall<Tag> {
  /** Delivered on the process's stdin, never in its argv. */
  stdin?: string;
  /** The account it runs as (`uid:gid` or a name). */
  user?: string;
  /** Its working directory. */
  workdir?: string;
  /** Variables set for this process alone, in this order. */
  environment?: Readonly<Record<string, string>>;
}

/** A source on this host that `copyIn` copies. */
export type CopySource = { directory: string } | { file: string };

/** A long-lived process in an instance, its pipes open: the one session
 *  shape `StackRuntime` uses too (a `docker exec -i` child satisfies it). */
export type { RuntimeSession } from '../runtime/types';

export interface RuntimeAccess<Tag = undefined> {
  readonly engine: RuntimeEngine;
  /** The instances of `stack` (one service of it, when given), stopped ones
   *  included, in the runtime's order. */
  list(
    filter: { stack: string; service?: string },
    call?: RuntimeCall<Tag>,
  ): Promise<string[]>;
  /** The instances of `stack` with the service each runs; `service` is null
   *  for an entry the runtime reported malformed. */
  listServices(
    stack: string,
    call?: RuntimeCall<Tag>,
  ): Promise<Array<{ id: string; service: string | null }>>;
  /** Every volume's name. */
  listVolumes(call?: RuntimeCall<Tag>): Promise<string[]>;
  /**
   * Read instances back. `metadataOnly` reads their identity, state, stack,
   * service and mounts alone: their environment and other labels never reach
   * this process (Docker: a `--format` projection).
   */
  inspect(
    ids: readonly string[],
    call?: RuntimeCall<Tag> & { metadataOnly?: boolean },
  ): Promise<RuntimeInstance[]>;
  /** Read images back. `metadataOnly` reads their identity, platform and
   *  their version and revision labels alone. */
  inspectImage(
    references: readonly string[],
    call?: RuntimeCall<Tag> & { metadataOnly?: boolean },
  ): Promise<RuntimeImage[]>;
  exec(
    name: string,
    argv: readonly string[],
    call?: RuntimeExecCall<Tag>,
  ): Promise<ExecResult>;
  /** Start `argv` in the instance with its stdin, stdout and stderr open. */
  execSession(name: string, argv: readonly string[]): RuntimeSession;
  /** Copy a local directory's contents, or one file, to `target` in the
   *  instance. The files keep this host's owner; the caller hands them on. */
  copyIn(
    name: string,
    source: CopySource,
    target: string,
    call?: RuntimeCall<Tag>,
  ): Promise<ExecResult>;
  /** Copy the contents of the directory `source` in the instance into the
   *  local `directory`. */
  copyOut(
    name: string,
    source: string,
    directory: string,
    call?: RuntimeCall<Tag>,
  ): Promise<ExecResult>;
  /** Stop the instances gracefully, with no time limit of the runtime's own:
   *  the call's bounds end the wait. */
  stop(names: readonly string[], call?: RuntimeCall<Tag>): Promise<ExecResult>;
  /** Restart the instance, giving it `graceSeconds` to stop. */
  restart(
    name: string,
    graceSeconds: number,
    call?: RuntimeCall<Tag>,
  ): Promise<ExecResult>;
}

/** One `docker <args>` invocation of a check, bounded by its budget. */
export type DockerRun<Tag = undefined> = (
  args: string[],
  call: RuntimeCall<Tag> & { stdin?: string },
) => Promise<ExecResult>;

export interface DockerCommandOptions {
  exec?: typeof exec;
  /** The environment the Docker CLI gets; the host's Docker settings alone
   *  by default, never ambient Compose interpolation. */
  environment?: () => Record<string, string>;
}

/**
 * An executor of any command, bounded by `budget`: what a check hands to a
 * reader that still takes an executor (`observeReadyState`). It never refuses
 * an unsuccessful result; its caller judges that.
 */
export function budgetedExec<Tag = undefined>(
  budget: RuntimeBudget<Tag>,
  options: DockerCommandOptions = {},
  tag?: Tag,
): typeof exec {
  return async (command, args, execution = {}) => {
    const bounds = budget.bounds(tag);
    let result: ExecResult;
    try {
      result = await (options.exec ?? exec)(command, args, {
        ...execution,
        silent: true,
        timeout: bounds.timeout,
        ...(bounds.maxOutputBytes === undefined
          ? {}
          : { maxOutputBytes: bounds.maxOutputBytes }),
        env: (options.environment ?? runtimeProcessEnvironment)(),
      });
    } catch {
      throw await budget.failed(tag);
    }
    budget.settled?.(result, tag);
    return result;
  };
}

/** `docker <args>` under `budget`, refusing an unsuccessful call unless it
 *  allows failure. */
export function budgetedDockerRun<Tag = undefined>(
  budget: RuntimeBudget<Tag>,
  options: DockerCommandOptions = {},
): DockerRun<Tag> {
  return async (args, call) => {
    const result = await budgetedExec(budget, options, call.tag)(
      'docker',
      args,
      call.stdin === undefined ? {} : { stdin: call.stdin },
    );
    if (!result.success && !call.allowFailure)
      throw await budget.refused(result, call.tag);
    return result;
  };
}

/** The bounds a call of `runtimeCommand` takes. */
export interface ManagedCommandTag {
  timeout?: number;
  maxOutputBytes?: number;
}

/**
 * The access the managed runtime's own steps use (the spawner's control, the
 * configuration activation, the writer stop): each call is one
 * `runtimeCommand`, with its fixed sentences and the host's Docker settings.
 */
export function managedCommandAccess(
  dependencies: RuntimeDependencies,
): RuntimeAccess<ManagedCommandTag> {
  return dockerRuntimeAccess<ManagedCommandTag>(async (args, call) => {
    if (call.stdin !== undefined)
      throw new Error('A managed runtime command takes no stdin.');
    return runtimeCommand(args, dependencies, {
      ...call.tag,
      ...(call.allowFailure ? { allowFailure: true } : {}),
    });
  });
}

/** The bounds of an access its caller gave none: a minute per call. Only
 *  `automationSession` builds such an access, and it calls `execSession`
 *  alone, which these bounds do not reach: the session keeps its own. */
function defaultBudget<Tag>(): RuntimeBudget<Tag> {
  return {
    bounds: () => ({ timeout: 60 }),
    failed: () =>
      new Error('The container runtime could not complete the command.'),
    refused: () => new Error('The container runtime refused the command.'),
  };
}

/** The `docker exec` argv for `argv` in `name`, as every caller spells it. */
export function dockerExecArgs(
  name: string,
  argv: readonly string[],
  call: Omit<RuntimeExecCall<unknown>, 'allowFailure' | 'tag'> = {},
): string[] {
  return [
    'exec',
    ...(call.stdin === undefined ? [] : ['-i']),
    ...(call.workdir === undefined ? [] : ['-w', call.workdir]),
    ...Object.entries(call.environment ?? {}).flatMap(([key, value]) => [
      '--env',
      `${key}=${value}`,
    ]),
    ...(call.user === undefined ? [] : ['--user', call.user]),
    name,
    ...argv,
  ];
}

const COMPOSE_PROJECT = 'com.docker.compose.project';
const COMPOSE_SERVICE = 'com.docker.compose.service';

const labelsSchema = z.record(z.string(), z.string());
/** `docker container inspect`, as loose as its most lenient reader: the
 *  readers' own demands are checked on the normalized record. */
const containerInspectSchema = z.array(
  z.object({
    Id: z.string(),
    Image: z.string().optional(),
    RestartCount: z.number().optional(),
    State: z
      .object({
        Running: z.boolean().optional(),
        StartedAt: z.string().optional(),
        Pid: z.number().optional(),
        Status: z.string().optional(),
        Dead: z.boolean().optional(),
      })
      .optional(),
    HostConfig: z
      .object({ RestartPolicy: z.object({ Name: z.string() }).optional() })
      .nullish(),
    Config: z
      .object({
        Image: z.string().optional(),
        Labels: labelsSchema.nullish(),
        Env: z.array(z.string()).nullish(),
      })
      .optional(),
    NetworkSettings: z
      .object({
        Networks: z
          .record(
            z.string(),
            z.object({
              NetworkID: z.string().optional(),
              IPAddress: z.string().optional(),
            }),
          )
          .nullish(),
      })
      .nullish(),
    Mounts: z
      .array(
        z.object({
          Type: z.string().optional(),
          Source: z.string().optional(),
          Destination: z.string().optional(),
        }),
      )
      .nullish(),
  }),
);
/** The metadata projection's fields; never the environment or other labels. */
const CONTAINER_METADATA_FORMAT =
  '{"id":{{json .Id}},"image":{{json .Image}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"running":{{json .State.Running}},"startedAt":{{json .State.StartedAt}},"restartCount":{{json .RestartCount}},"mounts":{{json .Mounts}}}';
const containerMetadataSchema = z.object({
  id: z.string(),
  image: z.string().nullish(),
  project: z.string().nullish(),
  service: z.string().nullish(),
  running: z.boolean().nullish(),
  startedAt: z.string().nullish(),
  restartCount: z.number().nullish(),
  mounts: containerInspectSchema.element.shape.Mounts,
});
const imageInspectSchema = z.array(
  z.object({
    Id: z.string().optional(),
    RepoDigests: z.array(z.string()).nullish(),
    Os: z.string().optional(),
    Architecture: z.string().optional(),
    Config: z.object({ Labels: labelsSchema.nullish() }).nullish(),
  }),
);
const IMAGE_METADATA_FORMAT =
  '{"id":{{json .Id}},"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}},"version":{{json (index .Config.Labels "org.opencontainers.image.version")}},"architecture":{{json .Architecture}},"os":{{json .Os}}}';
const imageMetadataSchema = z.object({
  id: z.string().nullish(),
  revision: z.string().nullish(),
  version: z.string().nullish(),
  architecture: z.string().nullish(),
  os: z.string().nullish(),
});

/** Only the keys that hold a value: a normalized record never carries an
 *  `undefined` key (`stableJson` refuses one). */
function defined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

const lines = (text: string) =>
  text
    .trim()
    .split('\n')
    .filter((line) => line !== '');

function normalizedMounts(
  mounts: z.infer<typeof containerInspectSchema.element.shape.Mounts>,
): RuntimeInstance['mounts'] {
  return mounts?.map((mount) =>
    defined({
      type: mount.Type,
      source: mount.Source,
      target: mount.Destination,
    }),
  );
}

/**
 * The Docker form of `RuntimeAccess`: every verb is one `docker` invocation,
 * run through `run`, which carries the check's bounds, environment and
 * failure sentences.
 */
export function dockerRuntimeAccess<Tag = undefined>(
  run: DockerRun<Tag> = budgetedDockerRun(defaultBudget<Tag>()),
): RuntimeAccess<Tag> {
  const command = (
    args: string[],
    call: (RuntimeCall<Tag> & { stdin?: string }) | undefined,
  ) => run(args, call ?? {});
  const read = async (
    args: string[],
    call: RuntimeCall<Tag> | undefined,
  ): Promise<string> => (await command(args, { tag: call?.tag })).stdout;
  return {
    engine: 'docker',
    list: async (filter, call) =>
      lines(
        await read(
          [
            'ps',
            '-a',
            '--no-trunc',
            '--filter',
            `label=${COMPOSE_PROJECT}=${filter.stack}`,
            ...(filter.service === undefined
              ? []
              : ['--filter', `label=${COMPOSE_SERVICE}=${filter.service}`]),
            '--format',
            '{{.ID}}',
          ],
          call,
        ),
      ),
    listServices: async (stack, call) =>
      lines(
        await read(
          [
            'ps',
            '-a',
            '--no-trunc',
            '--filter',
            `label=${COMPOSE_PROJECT}=${stack}`,
            '--format',
            `{{.ID}}\t{{.Label "${COMPOSE_SERVICE}"}}`,
          ],
          call,
        ),
      ).map((line) => {
        const columns = line.split('\t');
        return {
          id: columns[0],
          service: columns.length === 2 ? columns[1] : null,
        };
      }),
    listVolumes: async (call) =>
      lines(await read(['volume', 'ls', '--format', '{{json .}}'], call)).map(
        (line) =>
          z.object({ Name: z.string().min(1) }).parse(JSON.parse(line)).Name,
      ),
    inspect: async (ids, call) => {
      if (call?.metadataOnly)
        return lines(
          await read(
            ['inspect', '--format', CONTAINER_METADATA_FORMAT, ...ids],
            call,
          ),
        ).map((line) => {
          const value = containerMetadataSchema.parse(JSON.parse(line));
          return defined<RuntimeInstance>({
            id: value.id,
            image: value.image ?? undefined,
            labels: Object.fromEntries(
              [
                [COMPOSE_PROJECT, value.project],
                [COMPOSE_SERVICE, value.service],
              ].filter(
                (entry): entry is [string, string] =>
                  typeof entry[1] === 'string',
              ),
            ),
            running: value.running ?? undefined,
            startedAt: value.startedAt ?? undefined,
            restartCount: value.restartCount ?? undefined,
            mounts: normalizedMounts(value.mounts),
          });
        });
      return containerInspectSchema
        .parse(JSON.parse(await read(['container', 'inspect', ...ids], call)))
        .map((value) =>
          defined<RuntimeInstance>({
            id: value.Id,
            image: value.Image,
            imageReference: value.Config?.Image,
            restartCount: value.RestartCount,
            running: value.State?.Running,
            startedAt: value.State?.StartedAt,
            pid: value.State?.Pid,
            status: value.State?.Status,
            dead: value.State?.Dead,
            restartPolicy: value.HostConfig?.RestartPolicy?.Name,
            labels: value.Config?.Labels ?? undefined,
            environmentSize: value.Config?.Env?.length,
            databaseConnections: value.Config?.Env?.filter((entry) =>
              entry.startsWith('DATABASE_URL='),
            ),
            networks:
              value.NetworkSettings?.Networks == null
                ? undefined
                : Object.fromEntries(
                    Object.entries(value.NetworkSettings.Networks).map(
                      ([name, network]) => [
                        name,
                        defined({
                          id: network.NetworkID,
                          address: network.IPAddress,
                        }),
                      ],
                    ),
                  ),
            mounts: normalizedMounts(value.Mounts),
          }),
        );
    },
    inspectImage: async (references, call) => {
      if (call?.metadataOnly)
        return lines(
          await read(
            [
              'image',
              'inspect',
              '--format',
              IMAGE_METADATA_FORMAT,
              ...references,
            ],
            call,
          ),
        ).map((line) => {
          const value = imageMetadataSchema.parse(JSON.parse(line));
          return defined<RuntimeImage>({
            id: value.id ?? undefined,
            os: value.os ?? undefined,
            architecture: value.architecture ?? undefined,
            labels: Object.fromEntries(
              [
                ['org.opencontainers.image.revision', value.revision],
                ['org.opencontainers.image.version', value.version],
              ].filter(
                (entry): entry is [string, string] =>
                  typeof entry[1] === 'string',
              ),
            ),
          });
        });
      return imageInspectSchema
        .parse(
          JSON.parse(await read(['image', 'inspect', ...references], call)),
        )
        .map((value) =>
          defined<RuntimeImage>({
            id: value.Id,
            repoDigests: value.RepoDigests ?? undefined,
            os: value.Os,
            architecture: value.Architecture,
            labels: value.Config ? (value.Config.Labels ?? null) : undefined,
          }),
        );
    },
    exec: (name, argv, call = {}) =>
      command(dockerExecArgs(name, argv, call), {
        ...(call.stdin === undefined ? {} : { stdin: call.stdin }),
        ...(call.allowFailure ? { allowFailure: true } : {}),
        ...(call.tag === undefined ? {} : { tag: call.tag }),
      }),
    execSession: (name, argv) =>
      Bun.spawn(['docker', ...dockerExecArgs(name, argv, { stdin: '' })], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
        env: runtimeProcessEnvironment(),
      }),
    copyIn: (name, source, target, call) =>
      command(
        'directory' in source
          ? ['cp', `${source.directory}/.`, `${name}:${target}/`]
          : ['cp', source.file, `${name}:${target}`],
        call,
      ),
    copyOut: (name, source, directory, call) =>
      command(['cp', `${name}:${source}/.`, `${directory}/`], call),
    stop: (names, call) => command(['stop', '--time=-1', ...names], call),
    restart: (name, graceSeconds, call) =>
      command(['restart', '--time', String(graceSeconds), name], call),
  };
}
