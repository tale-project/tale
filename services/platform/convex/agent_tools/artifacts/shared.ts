import { z } from 'zod/v4';

export const artifactTypeEnum = z.enum([
  'html',
  'svg',
  'markdown',
  'mermaid',
  'code',
  // Runnable types: source code that executes in the server sandbox via the
  // shared sandbox spawner. The artifact's `content` is the script; the
  // canvas-runnable-code-renderer subscribes to the row's `run*` fields
  // to show live progress + the final output file chips.
  'python_runnable',
  'node_runnable',
]);

export type ArtifactType = z.infer<typeof artifactTypeEnum>;

const RUNNABLE_TYPES = new Set<ArtifactType>([
  'python_runnable',
  'node_runnable',
]);

export function isValidArtifactType(value: string): value is ArtifactType {
  return (
    value === 'html' ||
    value === 'svg' ||
    value === 'markdown' ||
    value === 'mermaid' ||
    value === 'code' ||
    value === 'python_runnable' ||
    value === 'node_runnable'
  );
}

export function isRunnableArtifactType(value: string): boolean {
  return RUNNABLE_TYPES.has(value as ArtifactType);
}

export function runnableLanguage(type: ArtifactType): 'python' | 'node' | null {
  if (type === 'python_runnable') return 'python';
  if (type === 'node_runnable') return 'node';
  return null;
}
