import { isValidProjectId } from './generate-project-id';
import { readProject } from './read-project';

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

/** For tests. */
export function resetProjectContext(): void {
  _projectId = null;
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
