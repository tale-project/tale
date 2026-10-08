import { preconditionError } from '../../utils/fail';
import { git } from '../config/releases/git';
import {
  AUTOMATION_PROTOCOL_SOURCE,
  automationWriterProtocolSchema,
  type AutomationWriterProtocol,
} from './automation-model';

/** Read a declaration, never execute code from a selected historical source. */
export function sourceAutomationProtocol(
  repoRoot: string,
  revision: string,
): AutomationWriterProtocol {
  const entries = git(
    repoRoot,
    'ls-tree',
    '-z',
    revision,
    '--',
    AUTOMATION_PROTOCOL_SOURCE,
  )
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  // A source predating this module has no protocol-2 writer. Its image still
  // must independently prove the same legacy capability at preparation.
  if (entries.length === 0) return 1;
  if (
    entries.length !== 1 ||
    !entries[0].startsWith('100644 blob ') ||
    entries[0].split('\t')[1] !== AUTOMATION_PROTOCOL_SOURCE
  )
    throw preconditionError(
      'Runtime automation protocol must be a committed regular source file.',
    );
  const bytes = git(
    repoRoot,
    'show',
    `${revision}:${AUTOMATION_PROTOCOL_SOURCE}`,
  );
  const declarations = bytes
    .toString('utf8')
    .match(/^export const ENGINE_PROTOCOL = [1-9][0-9]*;$/gm);
  const parsed = automationWriterProtocolSchema.safeParse(
    declarations?.length === 1
      ? Number(declarations[0].split(' = ')[1].slice(0, -1))
      : null,
  );
  if (bytes.length > 16_384 || !parsed.success)
    throw preconditionError(
      'Runtime source has an unsupported automation writer protocol.',
    );
  return parsed.data;
}
