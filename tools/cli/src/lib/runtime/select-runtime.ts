import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readProject } from '../project/read-project';
import {
  guardDeclaredEngine,
  incusNotAvailableYet,
} from '../project/runtime-declaration';
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
 * The runtime engine the workspace at `projectDir` declares. A workspace
 * without `tale.json` declares nothing, which is Docker. `readProject` holds
 * the declaration to the one runtime schema (`runtime-declaration.ts`), so an
 * engine the CLI does not know is refused rather than read as Docker:
 * deploying on the wrong runtime would build a second stack beside the
 * first. `TALE_RUNTIME`, when set, must name the same engine.
 */
export async function declaredEngine(
  projectDir: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<RuntimeEngine> {
  const engine = existsSync(join(projectDir, 'tale.json'))
    ? ((await readProject(projectDir)).runtime?.engine ?? 'docker')
    : 'docker';
  guardDeclaredEngine(engine, environment);
  return engine;
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
