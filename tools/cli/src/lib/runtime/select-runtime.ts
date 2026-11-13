import { resolve } from 'node:path';

import { IncusClient } from '@tale/incus/client';

import { preconditionError } from '../../utils/fail';
import { declaredEngine } from '../project/declared-engine';
import { readProject } from '../project/read-project';
import {
  createDockerRuntime,
  type DockerRuntimeOverrides,
} from './docker/docker-runtime';
import {
  readIncusCredentials,
  workspaceIncusDirectory,
} from './incus/credentials';
import {
  createIncusRuntime,
  type IncusRuntime,
  type IncusRuntimeOptions,
} from './incus/incus-runtime';
import type { RuntimeEngine, StackRuntime } from './types';

/** What a command hands the runtime it selects: the collaborators of the
 *  Docker runtime, and the Incus connection of an Incus one. */
export interface RuntimeOverrides {
  docker?: DockerRuntimeOverrides;
  incus?: IncusRuntimeOptions;
}

/**
 * The runtime for one engine. Incus needs its connection (the client, the
 * declaration, the stack and the state root); without one it is refused.
 */
export function runtimeForEngine(
  engine: RuntimeEngine,
  overrides: RuntimeOverrides = {},
): StackRuntime {
  if (engine === 'incus') {
    if (overrides.incus === undefined)
      throw preconditionError(
        'The Incus runtime needs its connection: the client, the runtime.incus declaration, the stack and the state root.',
      );
    return createIncusRuntime(overrides.incus);
  }
  return createDockerRuntime(overrides.docker);
}

/**
 * The Incus runtime of the workspace at `projectDir` (design 7.2): the
 * stack is the project id, its state lives in the workspace (`.tale/incus/`
 * beside the deploy lock), and the CLI dials the declared endpoint with the
 * workspace's own credentials (`.tale/incus/`, or `TALE_INCUS_DIR`), pinned
 * to the server certificate there.
 */
async function workspaceIncusRuntime(
  projectDir: string,
  overrides: Partial<IncusRuntimeOptions> = {},
  environment: NodeJS.ProcessEnv = process.env,
  which: 'engine' | 'next' = 'engine',
): Promise<IncusRuntime> {
  const directory = resolve(projectDir);
  const project = await readProject(directory);
  const runtime = which === 'next' ? project.runtime?.next : project.runtime;
  const declaration = runtime?.incus;
  if (runtime?.engine !== 'incus' || declaration === undefined)
    throw preconditionError(
      which === 'next'
        ? `tale.json in ${directory} declares no Incus runtime to migrate to (runtime.next).`
        : `tale.json in ${directory} declares no Incus runtime.`,
    );
  const client =
    overrides.client ??
    new IncusClient({
      endpoint:
        declaration.endpoint ?? `https://${declaration.network.gateway}:8443`,
      project: declaration.project,
      tls: await readIncusCredentials(
        workspaceIncusDirectory(directory, environment),
      ),
      signal: () => undefined,
    });
  return createIncusRuntime({
    ...overrides,
    client,
    declaration,
    stack: project.id ?? 'tale',
    stateRoot: directory,
  });
}

/**
 * The runtime a command drives, chosen once from what the workspace
 * declares and passed to every step after: Docker by default, or the
 * workspace's Incus runtime (`workspaceIncusRuntime`).
 */
export async function selectRuntime(
  projectDir: string,
  overrides: {
    docker?: DockerRuntimeOverrides;
    incus?: Partial<IncusRuntimeOptions>;
  } = {},
): Promise<StackRuntime> {
  if ((await declaredEngine(projectDir)) === 'incus')
    return workspaceIncusRuntime(projectDir, overrides.incus);
  return runtimeForEngine(
    'docker',
    overrides.docker === undefined ? {} : { docker: overrides.docker },
  );
}

/**
 * The Incus runtime `runtime.next` declares, which `tale runtime migrate`
 * moves a Docker workspace to (design 14): the same stack, state root and
 * credentials (`.tale/incus/`, where `tale incus bootstrap` writes them) as
 * the workspace's own Incus runtime once the migration flips the engine.
 */
export function migrationIncusRuntime(
  projectDir: string,
  overrides: Partial<IncusRuntimeOptions> = {},
): Promise<IncusRuntime> {
  return workspaceIncusRuntime(projectDir, overrides, process.env, 'next');
}

/** The workspace's own Incus runtime, whatever `TALE_RUNTIME` says: the
 * runtime a migration back to Docker stops (design 14). */
export function declaredIncusRuntime(
  projectDir: string,
  overrides: Partial<IncusRuntimeOptions> = {},
): Promise<IncusRuntime> {
  return workspaceIncusRuntime(projectDir, overrides, process.env, 'engine');
}
