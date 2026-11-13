import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { RuntimeEngine } from '../runtime/types';
import { readProject } from './read-project';
import {
  dockerOnlyLoop,
  type DockerOnlyLoop,
  guardDeclaredEngine,
} from './runtime-declaration';

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
 * Refuse a Docker-only local developer loop (`tale dev`, the sandbox
 * device) in a workspace that declares Incus (design D-35). No workspace is
 * Docker's; an unreadable declaration is refused, as `declaredEngine` does.
 */
export async function assertDockerLoop(
  projectDir: string | null,
  loop: DockerOnlyLoop,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (projectDir === null) return;
  if ((await declaredEngine(projectDir, environment)) === 'incus')
    throw dockerOnlyLoop(loop);
}
