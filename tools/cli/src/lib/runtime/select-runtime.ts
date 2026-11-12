import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { preconditionError } from '../../utils/fail';
import { readProject } from '../project/read-project';
import {
  createDockerRuntime,
  type DockerRuntimeOverrides,
} from './docker/docker-runtime';
import {
  RUNTIME_ENGINES,
  type RuntimeEngine,
  type StackRuntime,
} from './types';

/**
 * The part of `tale.json` that names the runtime. Absent, the workspace runs
 * on Docker, as every workspace did before the field existed.
 */
const runtimeDeclarationSchema = z.object({
  runtime: z.object({ engine: z.enum(RUNTIME_ENGINES).optional() }).optional(),
});

/**
 * The runtime engine the workspace at `projectDir` declares. A workspace
 * without `tale.json` declares nothing, which is Docker; an engine the CLI
 * does not know is refused rather than read as Docker, because deploying on
 * the wrong runtime would build a second stack beside the first.
 */
export async function declaredEngine(
  projectDir: string,
): Promise<RuntimeEngine> {
  if (!existsSync(join(projectDir, 'tale.json'))) return 'docker';
  const declaration = runtimeDeclarationSchema.safeParse(
    await readProject(projectDir),
  );
  if (!declaration.success)
    throw preconditionError(
      `tale.json in ${projectDir} names a runtime engine this CLI does not know.`,
      `Set runtime.engine to one of: ${RUNTIME_ENGINES.join(', ')}.`,
    );
  return declaration.data.runtime?.engine ?? 'docker';
}

/** The runtime for one engine. */
export function runtimeForEngine(
  engine: RuntimeEngine,
  overrides: { docker?: DockerRuntimeOverrides } = {},
): StackRuntime {
  if (engine === 'incus')
    throw preconditionError(
      'tale.json declares runtime.engine "incus", which this CLI cannot run yet: the Incus runtime is not built yet.',
      'Remove runtime.engine from tale.json to deploy on Docker.',
    );
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
