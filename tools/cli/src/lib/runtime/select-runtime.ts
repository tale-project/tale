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
import type { RuntimeEngine, StackRuntime } from './types';

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

/** The runtime for one engine. */
export function runtimeForEngine(
  engine: RuntimeEngine,
  overrides: { docker?: DockerRuntimeOverrides } = {},
): StackRuntime {
  if (engine === 'incus') throw incusNotAvailableYet('workspace');
  return createDockerRuntime(overrides.docker);
}

/**
 * The runtime a command drives, chosen once from what the workspace
 * declares and passed to every step after.
 */
export async function selectRuntime(
  projectDir: string,
  overrides: { docker?: DockerRuntimeOverrides } = {},
): Promise<StackRuntime> {
  return runtimeForEngine(await declaredEngine(projectDir), overrides);
}
