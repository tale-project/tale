import { declaredEngine } from '../project/declared-engine';
import { incusNotAvailableYet } from '../project/runtime-declaration';
import {
  createDockerRuntime,
  type DockerRuntimeOverrides,
} from './docker/docker-runtime';
import {
  createIncusRuntime,
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
    if (overrides.incus === undefined) throw incusNotAvailableYet('workspace');
    return createIncusRuntime(overrides.incus);
  }
  return createDockerRuntime(overrides.docker);
}

/**
 * The runtime a command drives, chosen once from what the workspace
 * declares and passed to every step after. A workspace that declares Incus
 * is refused until the workspace path runs on it.
 */
export async function selectRuntime(
  projectDir: string,
  overrides: { docker?: DockerRuntimeOverrides } = {},
): Promise<StackRuntime> {
  // Only Docker's collaborators pass: a workspace never carries an Incus
  // connection yet, so a declared incus is refused.
  const { docker } = overrides;
  return runtimeForEngine(
    await declaredEngine(projectDir),
    docker === undefined ? {} : { docker },
  );
}
