import { basename, join } from 'node:path';

import * as logger from '../../utils/logger';
import { generateProjectId, isValidProjectId } from './generate-project-id';
import { readProject } from './read-project';
import { writeProject } from './write-project';

let _projectId: string | null = null;

/**
 * Explicitly set the project ID. Called once per command after reading tale.json.
 * Exported primarily for tests and for init.ts, which sets the ID during
 * project creation before tale.json exists on disk.
 */
export function setProjectId(id: string): void {
  _projectId = id;
}

/**
 * Returns the resolved project ID. Throws if `resolveProjectContext()` has
 * not been called first — this indicates a missing bootstrap call in a
 * command entry point and is a bug, not a user error.
 */
export function getProjectId(): string {
  if (_projectId === null) {
    throw new Error(
      'Project context not initialized. This is a bug — resolveProjectContext() must be called before getProjectId().',
    );
  }
  return _projectId;
}

/**
 * Read tale.json from the project directory, validate the `id` field, and
 * cache it in the module-level singleton. Must be called by every command
 * that uses Docker before any Docker operation runs.
 *
 * Throws with an actionable message if the project has no valid ID,
 * directing the user to `tale upgrade` (which auto-assigns IDs to legacy projects).
 */
export async function resolveProjectContext(projectDir: string): Promise<void> {
  const project = await readProject(projectDir);
  const id = project.id;
  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error(
      'Project has no valid ID. Run "tale upgrade" to assign one.',
    );
  }
  if (!isValidProjectId(id)) {
    throw new Error(
      `Project ID "${id}" in tale.json is invalid. Expected [a-z0-9][a-z0-9-]* and max 40 chars.`,
    );
  }
  setProjectId(id);
}

/**
 * Like `resolveProjectContext`, but if the project has no `id` yet (legacy
 * project pre-dating per-project isolation) auto-assigns one, persists it
 * atomically, and proceeds. This is a UX smoothing for `tale start` /
 * `tale deploy` so users don't have to run `tale upgrade` as a separate step.
 *
 * An invalid (non-empty but malformed) ID still throws — it signals
 * tampering or corruption that the user should resolve explicitly.
 */
export async function resolveOrAssignProjectContext(
  projectDir: string,
): Promise<void> {
  const project = await readProject(projectDir);
  const id = project.id;
  if (typeof id === 'string' && id.trim() !== '') {
    if (!isValidProjectId(id)) {
      throw new Error(
        `Project ID "${id}" in tale.json is invalid. Expected [a-z0-9][a-z0-9-]* and max 40 chars.`,
      );
    }
    setProjectId(id);
    return;
  }

  const assigned = generateProjectId(basename(projectDir));
  project.id = assigned;
  await writeProject(join(projectDir, 'tale.json'), project);
  setProjectId(assigned);
  logger.info(`Assigned project ID: ${assigned}`);
}
