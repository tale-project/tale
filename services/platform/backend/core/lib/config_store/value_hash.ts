import { configurationHash } from '@tale/shared/utils/configuration-hash';

/** Native JSON value identity shared by managed resource CAS and the CLI's
 * sorted-JSON configuration digest. Null denotes an absent native resource. */
export function managedConfigurationHash(config: unknown): string | null {
  return config === null ? null : configurationHash(config);
}
