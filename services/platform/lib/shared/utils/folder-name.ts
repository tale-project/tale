import { z } from 'zod';

import { canonicalExternalKey } from './external-key.ts';
import { forbiddenNameCharKind } from './plain-name.ts';

export const FOLDER_NAME_MAX = 128;

export type FolderNameReason =
  | 'blank'
  | 'too_long'
  | 'separator'
  | 'control'
  | 'dot';

export function folderNameReason(name: string): FolderNameReason | undefined {
  if (name.length === 0) return 'blank';
  if (name.length > FOLDER_NAME_MAX) return 'too_long';
  const kind = forbiddenNameCharKind(name);
  if (kind !== undefined) return kind;
  if (name === '.' || name === '..') return 'dot';
  return undefined;
}

export function folderNameSchema(
  requiredMessage: string,
  invalidMessage: string,
) {
  return z
    .string()
    .transform(canonicalExternalKey)
    .pipe(
      z
        .string()
        .min(1, requiredMessage)
        .refine((name) => folderNameReason(name) === undefined, invalidMessage),
    );
}
