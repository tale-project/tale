'use client';

import { useT } from '@/lib/i18n/client';

import { useProviderConfig } from '../../hooks/use-provider-config-context';
import {
  ProviderOptionsEditor,
  providerOptionsToJsonString,
} from '../provider-options-editor';

export function ProviderOptionsSection() {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { config, isSaving, saveConfig } = useProviderConfig();

  return (
    <ProviderOptionsEditor
      initialJson={providerOptionsToJsonString(config.providerOptions)}
      isSaving={isSaving}
      onSave={async (parsed) => {
        await saveConfig({ providerOptions: parsed });
      }}
      copy={{
        title: t('providers.providerOptions.providerLevelTitle'),
        description: t('providers.providerOptions.providerLevelDescription'),
        guideLabel: t('providers.providerOptions.guideLabel'),
        notConfigured: t('providers.providerOptions.notConfigured'),
        editLabel: t('providers.editGeneral'),
        saveLabel: t('providers.providerOptions.save'),
        cancelLabel: tCommon('actions.cancel'),
        saveSuccess: t('providers.providerOptions.saveSuccess'),
        saveError: t('providers.providerOptions.saveError'),
        exampleLabel: t('providers.providerOptions.exampleLabel'),
        discardConfirmTitle: t('providers.providerOptions.discardConfirmTitle'),
        discardConfirmDescription: t(
          'providers.providerOptions.discardConfirmDescription',
        ),
        discardConfirmAction: t(
          'providers.providerOptions.discardConfirmAction',
        ),
        discardConfirmKeep: t('providers.providerOptions.discardConfirmKeep'),
        objectRequiredError: t('providers.providerOptions.objectRequiredError'),
      }}
    />
  );
}
