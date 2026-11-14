/**
 * The Incus form of `RuntimeAccess` (design 4, 7.1; M1 carry-over 2): what
 * acceptance, observation, provisioning, the credential export, the spawner's
 * control and the runtime configuration ask of an applied stack, answered
 * over the Incus REST API instead of `docker` argv.
 *
 * The managed checks name an instance the way Docker does: by a 64-hex
 * identity that changes whenever the instance is made again. Incus has no
 * such identity, so the access derives one from the project, the instance
 * name and Incus's own creation time (`instanceIdentity`), and resolves it
 * back on every call; a name of the stack is taken as well. Each instance is
 * read once into the same `InstanceInfo` the stack's custody check reads
 * (`runtime-incus-custody.ts`), and `RuntimeInstance` is derived from it, so
 * the managed modules and custody share one normalized readback. Labels come
 * back under the Compose names the checks read (`com.docker.compose.*`),
 * from the stack's own `user.tale.*` labels.
 *
 * No environment value leaves the access: `bundledDatabase` is decided here,
 * from the instance's own `environment.DATABASE_URL` (R-15).
 */

import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';

import type { IncusInstance } from '@tale/incus/api';
import { writeFile as writeIncusFile } from '@tale/incus/files';

import { CliError, preconditionError } from '../../utils/fail';
import type { IncusRuntime } from '../runtime/incus/incus-runtime';
import { placeOf } from '../runtime/incus/verbs/files';
import type {
  ExecResult,
  InstanceInfo,
  RuntimeSession,
} from '../runtime/types';
import {
  bundledDatabaseOf,
  COPY_OUT_LIMIT_SENTENCE,
  type CopySource,
  type RuntimeAccess,
  type RuntimeBudget,
  type RuntimeCall,
  type RuntimeExecCall,
  type RuntimeImage,
  type RuntimeInstance,
} from './runtime-access';

const COMPOSE_PROJECT = 'com.docker.compose.project';
const COMPOSE_SERVICE = 'com.docker.compose.service';
const COMPOSE_NUMBER = 'com.docker.compose.container-number';
const COMPOSE_ONEOFF = 'com.docker.compose.oneoff';
const HEX_IDENTITY = /^[a-f0-9]{64}$/;
const NEVER_STARTED = '0001-01-01T00:00:00Z';
const DIGEST = /^sha256:[a-f0-9]{64}$/;
/** The mode the backend-local CLI binary is pushed with (design 7.1). */
const BINARY_MODE = '0550';

/**
 * The 64-hex identity of one instance: a new one for every instance made
 * under the same name, as a Docker container ID is.
 */
export function instanceIdentity(
  project: string,
  instance: Pick<IncusInstance, 'name' | 'createdAt'>,
): string {
  return createHash('sha256')
    .update(
      `tale-incus-instance\0${project}\0${instance.name}\0${instance.createdAt}`,
    )
    .digest('hex');
}

/** The labels a managed check reads, under Compose's names, from the
 * stack's own labels; every other `user.tale.*` label passes as it is. */
function composeLabels(
  info: InstanceInfo,
  config: Readonly<Record<string, string>>,
): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(config))
    if (key.startsWith('user.tale.')) labels[key] = value;
  labels[COMPOSE_PROJECT] = info.stack;
  labels[COMPOSE_SERVICE] = info.service;
  labels[COMPOSE_NUMBER] = String(info.index);
  labels[COMPOSE_ONEOFF] = info.oneOff ? 'True' : 'False';
  return labels;
}

function environmentEntries(
  config: Readonly<Record<string, string>>,
): [string, string][] {
  return Object.entries(config).filter(([key]) =>
    key.startsWith('environment.'),
  );
}

/**
 * `RuntimeInstance` of one Incus instance, derived from its `InstanceInfo`
 * (the custody check's readback) and its configuration, whose environment
 * yields a count and `bundledDatabase` alone.
 */
function runtimeInstanceOf(
  id: string,
  info: InstanceInfo,
  instance: Pick<IncusInstance, 'config' | 'devices'>,
  metadataOnly = false,
  imageReference?: string,
): RuntimeInstance {
  const mounts = info.mounts.map((mount) => ({
    type: mount.kind === 'bind' ? 'bind' : 'volume',
    source: mount.source,
    target: mount.target,
  }));
  const record: RuntimeInstance = {
    id,
    ...(info.image.digest === null ? {} : { image: info.image.digest }),
    labels: metadataOnly
      ? { [COMPOSE_PROJECT]: info.stack, [COMPOSE_SERVICE]: info.service }
      : composeLabels(info, instance.config),
    running: info.running,
    // Docker's zero time for an instance that never started.
    startedAt: info.startedAt ?? NEVER_STARTED,
    restartCount: info.restarted ? 1 : 0,
    mounts,
  };
  if (metadataOnly) return record;
  const environment = environmentEntries(instance.config);
  const nic = Object.values(instance.devices).find(
    (device) => device.type === 'nic',
  );
  return {
    ...record,
    ...(imageReference === undefined ? {} : { imageReference }),
    status: info.state,
    dead: info.state === 'dead',
    restartPolicy:
      instance.config['boot.autorestart'] === 'false' ? 'no' : 'always',
    environmentSize: environment.length,
    bundledDatabase: bundledDatabaseOf(
      environment
        .filter(([key]) => key === 'environment.DATABASE_URL')
        .map(([, value]) => value),
    ),
    ...(nic?.network === undefined
      ? {}
      : {
          networks: {
            [nic.network]:
              info.address === null ? {} : { address: info.address },
          },
        }),
  };
}

/** A session whose command is still being started: what `execSession`
 * returns at once, as Docker's child process is. Writes wait for the
 * command; a start that fails ends the session with exit code 1. */
export function deferredSession(
  pending: Promise<RuntimeSession>,
): RuntimeSession {
  let exitCode: number | null = null;
  let queue: Promise<RuntimeSession | null> = pending.catch((error) => {
    console.warn(
      `The Incus exec session could not start: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  });
  const after = (step: (session: RuntimeSession) => unknown) => {
    queue = queue.then(async (session) => {
      if (session !== null) await step(session);
      return session;
    });
  };
  const forward = (
    pick: (session: RuntimeSession) => ReadableStream<Uint8Array>,
  ) => {
    const pipe = new TransformStream<Uint8Array, Uint8Array>();
    queue
      .then((session) =>
        session === null
          ? pipe.writable.close()
          : pick(session).pipeTo(pipe.writable),
      )
      .catch((error: unknown) => {
        console.warn(
          `An Incus exec session stream ended: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    return pipe.readable;
  };
  const stdout = forward((session) => session.stdout);
  const stderr = forward((session) => session.stderr);
  const exited = queue.then(async (session) => {
    exitCode = session === null ? 1 : await session.exited;
    return exitCode;
  });
  return {
    stdin: {
      write: (chunk) => after((session) => session.stdin.write(chunk)),
      flush: () => after((session) => session.stdin.flush()),
      end: () => after((session) => session.stdin.end()),
    },
    stdout,
    stderr,
    exited,
    get exitCode() {
      return exitCode;
    },
    kill: () => after((session) => session.kill()),
  };
}

export interface IncusAccessOptions<Tag> {
  /** The runtime of the deployment's stack. */
  runtime: IncusRuntime;
  /** The check's bounds and sentences. */
  budget: RuntimeBudget<Tag>;
  /** The image references of the deployment, so an image named by its
   * digest alone (an instance's `image`) is read from its repository. */
  images: readonly string[];
}

/** A `uid:gid` account; an Incus exec takes no account name. */
function account(
  user: string | undefined,
): { uid: number; gid: number } | undefined {
  if (user === undefined) return undefined;
  const match = /^(\d{1,10}):(\d{1,10})$/.exec(user);
  if (match === null)
    throw preconditionError(
      `An Incus exec runs as a uid:gid account, not ${JSON.stringify(user)}.`,
    );
  return { uid: Number(match[1]), gid: Number(match[2]) };
}

/** `argv` with the call's working directory and environment, which an
 * Incus exec does not take itself: `env` sets the variables, and a shell
 * enters the directory before it replaces itself with the command. */
export function wrappedArgv(
  argv: readonly string[],
  call: Pick<RuntimeExecCall<unknown>, 'workdir' | 'environment'>,
): string[] {
  const environment = Object.entries(call.environment ?? {}).map(
    ([key, value]) => `${key}=${value}`,
  );
  const command =
    environment.length > 0 ? ['env', ...environment, ...argv] : [...argv];
  return call.workdir === undefined
    ? command
    : ['sh', '-c', 'cd -- "$0" && exec "$@"', call.workdir, ...command];
}

/** The Incus form of `RuntimeAccess` for one stack. */
export function incusRuntimeAccess<Tag = undefined>(
  options: IncusAccessOptions<Tag>,
): RuntimeAccess<Tag> {
  const { runtime, budget } = options;
  const client = runtime.client;

  /** Run one bounded call: refused once its deadline is spent, and turned
   * into the check's own failure when it cannot complete. */
  const bounded = async <T>(
    tag: Tag | undefined,
    work: (bounds: { timeout: number; maxOutputBytes?: number }) => Promise<T>,
  ): Promise<T> => {
    const bounds = budget.bounds(tag);
    try {
      return await work(bounds);
    } catch (error) {
      // A refusal of the CLI's own (an account it cannot use) stands.
      if (error instanceof CliError) throw error;
      console.warn(
        `An Incus call of the check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw await budget.failed(tag);
    }
  };
  const settle = async (
    result: ExecResult,
    call: RuntimeCall<Tag> | undefined,
  ): Promise<ExecResult> => {
    budget.settled?.(result, call?.tag);
    if (!result.success && !call?.allowFailure)
      throw await budget.refused(result, call?.tag);
    return result;
  };
  const stackInstances = async () =>
    (await client.listInstances()).filter(
      (instance) => instance.config['user.tale.stack'] === runtime.stack,
    );
  /** The instance an identity or a name of the stack names. */
  const resolve = async (reference: string): Promise<IncusInstance> => {
    const found = (await stackInstances()).find((instance) =>
      HEX_IDENTITY.test(reference)
        ? instanceIdentity(client.project, instance) === reference
        : instance.name === reference,
    );
    if (found === undefined)
      throw new Error(
        `The stack ${runtime.stack} has no instance ${reference}.`,
      );
    return found;
  };
  /** The registry reference of an image named by reference or digest. */
  const referenceOf = (image: string): string => {
    if (!DIGEST.test(image)) return image;
    const reference = options.images.find((candidate) =>
      candidate.endsWith(`@${image}`),
    );
    if (reference === undefined)
      throw new Error(`No image of the deployment has the digest ${image}.`);
    return reference;
  };

  return {
    engine: 'incus',
    list: (filter, call) =>
      bounded(call?.tag, async () =>
        (await client.listInstances())
          .filter(
            (instance) =>
              instance.config['user.tale.stack'] === filter.stack &&
              (filter.service === undefined ||
                instance.config['user.tale.service'] === filter.service),
          )
          .map((instance) => instanceIdentity(client.project, instance)),
      ),
    listServices: (stack, call) =>
      bounded(call?.tag, async () =>
        (await client.listInstances())
          .filter((instance) => instance.config['user.tale.stack'] === stack)
          .map((instance) => ({
            id: instanceIdentity(client.project, instance),
            service: instance.config['user.tale.service'] ?? null,
          })),
      ),
    listVolumes: (call) =>
      bounded(call?.tag, async () =>
        (await runtime.listVolumes()).map((volume) => volume.name),
      ),
    inspect: (ids, call) =>
      bounded(call?.tag, async () => {
        const records: RuntimeInstance[] = [];
        for (const id of ids) {
          const instance = await resolve(id);
          const info = await runtime.inspect(instance.name);
          if (info === null)
            throw new Error(`The instance ${instance.name} is gone.`);
          records.push(
            runtimeInstanceOf(
              instanceIdentity(client.project, instance),
              info,
              instance,
              call?.metadataOnly === true,
              info.image.digest === null
                ? undefined
                : options.images.find((reference) =>
                    reference.endsWith(`@${info.image.digest}`),
                  ),
            ),
          );
        }
        return records;
      }),
    inspectImage: (references, call) =>
      bounded(call?.tag, async () => {
        const images: RuntimeImage[] = [];
        for (const image of references) {
          const reference = referenceOf(image);
          const facts = await runtime.inspectImage(reference);
          const labels = call?.metadataOnly
            ? Object.fromEntries(
                [
                  'org.opencontainers.image.revision',
                  'org.opencontainers.image.version',
                ]
                  .filter((key) => facts.labels[key] !== undefined)
                  .map((key) => [key, facts.labels[key] ?? '']),
              )
            : facts.labels;
          images.push({
            id: facts.digest,
            ...(call?.metadataOnly ? {} : { repoDigests: [reference] }),
            os: facts.os,
            architecture: facts.architecture,
            labels:
              call?.metadataOnly || Object.keys(labels).length > 0
                ? labels
                : null,
          });
        }
        return images;
      }),
    exec: async (name, argv, call = {}) =>
      settle(
        await bounded(call.tag, async (bounds) => {
          const instance = await resolve(name);
          const user = account(call.user);
          return runtime.exec(instance.name, wrappedArgv(argv, call), {
            ...(call.stdin === undefined ? {} : { stdin: call.stdin }),
            timeoutS: bounds.timeout,
            ...(bounds.maxOutputBytes === undefined
              ? {}
              : { maxOutputBytes: bounds.maxOutputBytes }),
            ...(user === undefined ? {} : { user }),
          });
        }),
        call,
      ),
    execSession: (name, argv) =>
      deferredSession(
        resolve(name).then((instance) =>
          runtime.execSession(instance.name, argv),
        ),
      ),
    copyIn: async (name, source: CopySource, target, call) =>
      settle(
        await bounded(call?.tag, async () => {
          const instance = await resolve(name);
          if ('directory' in source) {
            const copied = await runtime.copyIn(
              instance.name,
              source.directory,
              target,
            );
            return copied.success
              ? { success: true, stdout: '', stderr: '', exitCode: 0 }
              : {
                  success: false,
                  stdout: '',
                  stderr: copied.detail,
                  exitCode: 1,
                };
          }
          // One file: the backend-local CLI, pushed executable (design 7.1).
          if (!(await lstat(source.file)).isFile())
            throw new Error(`${source.file} is not a regular file.`);
          const place = await placeOf(runtime.verbContext, instance, target);
          await writeIncusFile(
            client,
            place.target,
            place.path,
            new Uint8Array(await readFile(source.file)),
            { uid: 0, gid: 0, mode: BINARY_MODE },
          );
          return { success: true, stdout: '', stderr: '', exitCode: 0 };
        }),
        call,
      ),
    copyOut: async (name, source, directory, { maxBytes, ...call }) => {
      const result = await bounded(call.tag, async (bounds) => {
        const instance = await resolve(name);
        return runtime.copyOut(instance.name, source, directory, {
          maxBytes,
          timeoutS: bounds.timeout,
        });
      });
      if (!result.success && /holds more than \d+ bytes/.test(result.stderr))
        throw preconditionError(COPY_OUT_LIMIT_SENTENCE);
      return settle(result, call);
    },
    stop: async (names, call) =>
      settle(
        await bounded(call?.tag, async () => {
          for (const name of names)
            await runtime.stopWithin((await resolve(name)).name, 'forever');
          return { success: true, stdout: '', stderr: '', exitCode: 0 };
        }),
        call,
      ),
    restart: async (name, graceSeconds, call) =>
      settle(
        await bounded(call?.tag, async () => {
          const instance = await resolve(name);
          await runtime.stopWithin(instance.name, graceSeconds);
          await runtime.start(instance.name);
          return { success: true, stdout: '', stderr: '', exitCode: 0 };
        }),
        call,
      ),
  };
}
