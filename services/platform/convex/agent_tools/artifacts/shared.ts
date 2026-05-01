import { z } from 'zod/v4';

export const artifactTypeEnum = z.enum([
  'html',
  'svg',
  'markdown',
  'mermaid',
  'code',
]);

export type ArtifactType = z.infer<typeof artifactTypeEnum>;

export function isValidArtifactType(value: string): value is ArtifactType {
  return (
    value === 'html' ||
    value === 'svg' ||
    value === 'markdown' ||
    value === 'mermaid' ||
    value === 'code'
  );
}
