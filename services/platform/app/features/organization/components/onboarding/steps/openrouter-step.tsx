'use client';

import { Heading } from '@tale/ui/heading';
import { Text } from '@tale/ui/text';
import { ExternalLink, KeyRound } from 'lucide-react';
import { useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { WizardStep } from '@/app/components/ui/wizard/wizard';
import {
  useFetchProviderModels,
  useSaveProvider,
  useSaveProviderSecret,
} from '@/app/features/settings/providers/hooks/mutations';
import { useT } from '@/lib/i18n/client';
import {
  OPENROUTER_BASE_URL,
  OPENROUTER_DISPLAY_NAME,
  OPENROUTER_KEYS_URL,
  OPENROUTER_PROVIDER_NAME,
  RECOMMENDED_OPENROUTER_MODELS,
} from '@/lib/shared/constants/openrouter-recommended';

/** Fallback cap when none of the curated IDs are in the live model list. */
const FALLBACK_MODEL_CAP = 20;

interface OpenRouterStepProps {
  /** The org the provider is saved under. Always set by the time this
   *  (post-workspace) step is reached. */
  organizationId: string | null;
}

/**
 * Optional first-run step: connect OpenRouter with a single key. One key
 * unlocks chat, vision and image generation/editing across many models, so
 * the wizard pre-configures a curated, capability-tagged model set (see
 * `RECOMMENDED_OPENROUTER_MODELS`) — intersected with OpenRouter's live model
 * list so retired IDs never persist. Leaving the key blank skips the step.
 */
export function OpenRouterStep({ organizationId }: OpenRouterStepProps) {
  const { t } = useT('onboarding');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { mutateAsync: fetchModels } = useFetchProviderModels();
  const { mutateAsync: saveProvider } = useSaveProvider();
  const { mutateAsync: saveProviderSecret } = useSaveProviderSecret();

  const connectOpenRouter = async (): Promise<boolean> => {
    const key = apiKey.trim();
    if (!key) return true; // nothing entered — skip without saving
    if (!organizationId) {
      console.error('OpenRouter step reached without an organization id');
      setError(t('provider.saveError'));
      return false;
    }

    setError(null);
    try {
      const fetched = await fetchModels({
        organizationId,
        baseUrl: OPENROUTER_BASE_URL,
        apiKey: key,
      });
      const availableIds = new Set(fetched.map((m) => m.id));

      let models = RECOMMENDED_OPENROUTER_MODELS.filter((m) =>
        availableIds.has(m.id),
      ).map((m) => ({ id: m.id, displayName: m.displayName, tags: m.tags }));

      // Curated IDs may all be retired/renamed — fall back to a capped slice
      // of whatever the account actually exposes, tagged as chat so at least
      // conversation works out of the box.
      if (models.length === 0) {
        models = fetched.slice(0, FALLBACK_MODEL_CAP).map((m) => ({
          id: m.id,
          displayName: m.id,
          tags: ['chat' as const],
        }));
      }

      if (models.length === 0) {
        setError(t('provider.noModelsError'));
        return false;
      }

      await saveProviderSecret({
        organizationId,
        providerName: OPENROUTER_PROVIDER_NAME,
        apiKey: key,
      });
      await saveProvider({
        organizationId,
        providerName: OPENROUTER_PROVIDER_NAME,
        config: {
          displayName: OPENROUTER_DISPLAY_NAME,
          baseUrl: OPENROUTER_BASE_URL,
          models,
        },
      });
      return true;
    } catch (err) {
      console.error('Failed to connect OpenRouter:', err);
      setError(t('provider.saveError'));
      return false;
    }
  };

  return (
    <WizardStep id="provider" onBeforeNext={connectOpenRouter}>
      <Heading level={2} className="text-base">
        <KeyRound className="text-fg-muted mr-2 inline size-4" aria-hidden />
        {t('provider.heading')}
      </Heading>
      <Text variant="muted">{t('provider.why')}</Text>

      <Input
        id="openrouter-key"
        type="password"
        label={t('provider.keyLabel')}
        placeholder={t('provider.keyPlaceholder')}
        value={apiKey}
        onChange={(e) => {
          setApiKey(e.target.value);
          if (error) setError(null);
        }}
        autoComplete="off"
        errorMessage={error ?? undefined}
        description={t('provider.keyHelp')}
      />

      <Text variant="muted" className="text-sm">
        {t('provider.hasKeyQuestion')}{' '}
        <a
          href={OPENROUTER_KEYS_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent-base inline-flex items-center gap-1 font-medium hover:underline"
        >
          {t('provider.getKeyLink')}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </Text>
    </WizardStep>
  );
}
