import { createHash } from 'node:crypto';

import { stableStringify } from '../../../../lib/shared/utils/stable-stringify';

/** Native JSON value identity shared by managed resource CAS and the CLI's
 * sorted-JSON configuration digest. Null denotes an absent native resource. */
export function managedConfigurationHash(config: unknown): string | null {
  return config === null
    ? null
    : createHash('sha256').update(stableStringify(config)).digest('hex');
}
