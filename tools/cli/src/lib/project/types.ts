export interface TaleProject {
  version: number;
  cliVersion: string;
  createdAt: string;
  name?: string;
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
