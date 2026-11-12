import type { RuntimeDeclaration } from './runtime-declaration';

export interface TaleProject {
  version: number;
  cliVersion: string;
  createdAt: string;
  name?: string;
  /**
   * Unique project ID used to namespace Docker resources (containers, volumes,
   * networks). Format: `{sanitized-name}-{6-hex}` (e.g. `my-app-a3f1b2`).
   * Optional for backwards compatibility with pre-ID projects; `tale update`
   * auto-assigns one to legacy projects.
   */
  id?: string;
  /**
   * The container runtime the workspace deploys on. Absent, Docker Compose,
   * as every workspace before the field. `readProject` validates it, so a
   * runtime this CLI cannot read never reaches a command.
   */
  runtime?: RuntimeDeclaration;
}

export interface Checksums {
  cliVersion: string;
  files: Record<string, string>;
}

export function isTaleProject(value: unknown): value is TaleProject {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.version === 'number' &&
    typeof obj.cliVersion === 'string' &&
    typeof obj.createdAt === 'string'
  );
}

export function isChecksums(value: unknown): value is Checksums {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.cliVersion === 'string' &&
    typeof obj.files === 'object' &&
    obj.files !== null
  );
}

export const CURRENT_PROJECT_VERSION = 1;
