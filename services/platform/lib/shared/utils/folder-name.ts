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

/**
 * The form's rule for a folder name, with one message per reason the server
 * refuses one, so a dialog names the rule a name broke. It parses to the
 * canonical name the server stores.
 */
export function folderNameSchemaByReason(
  messages: Readonly<Record<FolderNameReason, string>>,
) {
  return z
    .string()
    .transform(canonicalExternalKey)
    .pipe(
      z.string().superRefine((name, ctx) => {
        const reason = folderNameReason(name);
        if (reason !== undefined) {
          ctx.addIssue({ code: 'custom', message: messages[reason] });
        }
      }),
    );
}

export function folderNameSchema(
  requiredMessage: string,
  invalidMessage: string,
) {
  return folderNameSchemaByReason({
    blank: requiredMessage,
    too_long: invalidMessage,
    separator: invalidMessage,
    control: invalidMessage,
    dot: invalidMessage,
  });
}
