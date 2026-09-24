import type { PlatformCapability } from '@/lib/shared/competences';

/**
 * The message key under `governance.competences.capabilities` that names
 * and explains each platform capability. Typed over the closed set, so a
 * capability added to `lib/shared/competences.ts` cannot ship without its
 * label and description.
 */
const CAPABILITY_MESSAGE_KEYS: Record<PlatformCapability, string> = {
  'tale:notifications.export': 'notificationsExport',
  'tale:rest.act-as': 'restActAs',
};

export function capabilityMessageKey(capability: PlatformCapability): string {
  return CAPABILITY_MESSAGE_KEYS[capability];
}
