import { storedModelAccessConfigSchema } from '@tale/shared/schemas/governance';
import type { CredentialSettingDependentKind } from '@tale/shared/schemas/providers';
import { useMemo } from 'react';

import type { Translator } from '@/app/features/settings/credentials/adapter';
import {
  isAccessEntryOffered,
  useListProviders,
} from '@/app/features/settings/governance/hooks/model-catalog';
import { useGovernancePolicy } from '@/app/features/settings/governance/hooks/queries';

import { type MaskedCredential, useProviderCredentials } from './queries';

/** A setting that still names a provider's models once its last active
 * credential is deleted, and how many of its entries do. */
export interface SettingLeftBehind {
  setting: CredentialSettingDependentKind | 'model-access';
  count: number;
}

/** The order the delete dialog names them in: the governance page's. */
const SETTING_ORDER = [
  'default-models',
  'model-access',
  'vision-model',
  'transcription-model',
  'image-generation',
  'standard-agent',
  'project-agents',
] as const satisfies readonly SettingLeftBehind['setting'][];

/** A setting's name in the delete dialog, with its count where it has one. */
export function settingLeftBehindLabel(
  t: Translator,
  { setting, count }: SettingLeftBehind,
): string {
  switch (setting) {
    case 'default-models':
      return t('providers.credential.dependentSettings.defaultModels', {
        count,
      });
    case 'model-access':
      return t('providers.credential.dependentSettings.modelAccess', { count });
    case 'vision-model':
      return t('providers.credential.dependentSettings.visionModel', { count });
    case 'transcription-model':
      return t('providers.credential.dependentSettings.transcriptionModel', {
        count,
      });
    case 'image-generation':
      return t('providers.credential.dependentSettings.imageGeneration', {
        count,
      });
    case 'standard-agent':
      return t('providers.credential.dependentSettings.standardAgent', {
        count,
      });
    case 'project-agents':
      return t('providers.credential.dependentSettings.projectAgents', {
        count,
      });
    default: {
      const exhaustive: never = setting;
      return exhaustive;
    }
  }
}

/**
 * What the delete dialog of a provider credential names as left on the
 * provider's models: the settings the server reads (`serverSettings`,
 * PCRED-R7), and the model access entries whose model only this provider
 * offers. Those rules name bare model ids (#5178), so only the catalog says
 * whose a model is, and they are counted here — as the editor shows them
 * (the list of the policy's mode), and not while the catalog is unknown.
 * Empty unless the credential is its provider's last active one.
 */
export function useSettingsLeftBehind({
  organizationId,
  credential,
  open,
  serverSettings,
}: {
  organizationId: string;
  credential: MaskedCredential;
  open: boolean;
  serverSettings: readonly SettingLeftBehind[] | undefined;
}): SettingLeftBehind[] {
  const { data: credentials } = useProviderCredentials(organizationId);
  const { offered } = useListProviders(organizationId);
  const { data: policy } = useGovernancePolicy(organizationId, 'model_access', {
    enabled: open,
  });

  return useMemo(() => {
    const lastActive =
      credential.status === 'active' &&
      credentials !== undefined &&
      !credentials.some(
        (other) =>
          other.id !== credential.id &&
          other.providerSlug === credential.providerSlug &&
          other.status === 'active',
      );
    const counts = new Map<SettingLeftBehind['setting'], number>(
      (serverSettings ?? []).map((item) => [item.setting, item.count]),
    );
    const access = storedModelAccessConfigSchema.safeParse(policy?.config);
    if (lastActive && offered !== null && access.success) {
      const config = access.data;
      const entries = new Set(
        config.enabled
          ? config.rules.flatMap((rule) =>
              config.mode === 'allowlist'
                ? rule.allowedModels
                : (rule.blockedModels ?? []),
            )
          : [],
      );
      const onlyHere = [...entries].filter(
        (entry) =>
          isAccessEntryOffered(offered, entry) &&
          !isAccessEntryOffered(offered, entry, credential.providerSlug),
      ).length;
      if (onlyHere > 0) counts.set('model-access', onlyHere);
    }
    return SETTING_ORDER.flatMap((setting) => {
      const count = counts.get(setting);
      return count === undefined ? [] : [{ setting, count }];
    });
  }, [credential, credentials, offered, policy, serverSettings]);
}
