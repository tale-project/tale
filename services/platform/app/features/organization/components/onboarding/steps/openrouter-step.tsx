'use client';

import { Text } from '@tale/ui/text';
import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { useWizard } from '@/app/components/ui/wizard/use-wizard';
import { WizardStep } from '@/app/components/ui/wizard/wizard';
import {
  useFetchProviderModels,
  useSaveProviderSecret,
} from '@/app/features/settings/providers/hooks/mutations';
import { useT } from '@/lib/i18n/client';
import {
  OPENROUTER_BASE_URL,
  OPENROUTER_KEYS_URL,
  OPENROUTER_PROVIDER_NAME,
} from '@/lib/shared/constants/openrouter-recommended';

/** OpenRouter API keys are prefixed `sk-or-` (e.g. `sk-or-v1-…`). */
const OPENROUTER_KEY_PREFIX = 'sk-or-';

/**
 * Map a failed connection to a specific, actionable cause so the user knows
 * whether to re-paste the key, check their account, or retry the network —
 * rather than the old one-size-fits-all "check it and try again".
 */
export function classifyConnectError(
  err: unknown,
): 'auth' | 'network' | 'generic' {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('unauthorized') ||
    msg.includes('forbidden') ||
    msg.includes('invalid api key') ||
    msg.includes('invalid key')
  ) {
    return 'auth';
  }
  if (
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('fetch failed') ||
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound')
  ) {
    return 'network';
  }
  return 'generic';
}

interface OpenRouterStepProps {
  /** The org the provider is saved under. Always set by the time this
   *  (post-workspace) step is reached. */
  organizationId: string | null;
}

/**
 * Optional first-run step: connect OpenRouter with a single key. One key
 * unlocks chat, vision and image generation/editing across the full model
 * catalog the org was scaffolded with. The step probes the key for validity,
 * then persists only the secret — the catalog (`openrouter.json`) is already
 * seeded by the org scaffold, so the wizard never shrinks the model list.
 * Leaving the key blank skips the step.
 */
export function OpenRouterStep({ organizationId }: OpenRouterStepProps) {
  const { t } = useT('onboarding');
  const { setStepPrimary } = useWizard();
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  // The primary button is always the forward action: the default "Next" while
  // the field is empty (leaving the key blank just advances — see the helper
  // note), relabelled to "Connect" once a key is entered so it's clear it will
  // save + verify before moving on.
  useEffect(() => {
    const hasKey = apiKey.trim().length > 0;
    setStepPrimary(
      'provider',
      hasKey ? { label: t('provider.connect'), variant: 'primary' } : undefined,
    );
    return () => setStepPrimary('provider', undefined);
  }, [apiKey, setStepPrimary, t]);

  const { mutateAsync: fetchModels } = useFetchProviderModels();
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
    // Catch an obviously-malformed paste before a confusing API round-trip.
    if (!key.startsWith(OPENROUTER_KEY_PREFIX)) {
      setError(t('provider.invalidKeyError'));
      return false;
    }
    try {
      // Probe the key first so an invalid key surfaces a clear auth error
      // before we persist anything.
      await fetchModels({
        organizationId,
        baseUrl: OPENROUTER_BASE_URL,
        apiKey: key,
      });

      // Write ONLY the key. The org scaffold seeds the full-catalog
      // `openrouter.json` from the builtin catalog (TALE_CONFIG_BUILTIN_DIR,
      // set in prod and by `scripts/dev.ts`), and the secret file is on the
      // scaffold's skip-list so it survives any ordering. Once the secret is
      // present, `hasApiKey` flips true and every model in the catalog is
      // usable in chat — consistent with every other org, no curated shrink.
      await saveProviderSecret({
        organizationId,
        providerName: OPENROUTER_PROVIDER_NAME,
        apiKey: key,
      });
      return true;
    } catch (err) {
      console.error('Failed to connect OpenRouter:', err);
      const kind = classifyConnectError(err);
      setError(
        t(
          kind === 'auth'
            ? 'provider.authError'
            : kind === 'network'
              ? 'provider.networkError'
              : 'provider.saveError',
        ),
      );
      return false;
    }
  };

  return (
    <WizardStep id="provider" onBeforeNext={connectOpenRouter}>
      {/* Heading + description live in the wizard hero now; the body is just
          the key field and its helper link, grouped tightly together. */}
      <div className="flex flex-col gap-2">
        <Input
          id="openrouter-key"
          type="password"
          label={t('provider.keyLabel')}
          // Renders a muted, normal-weight "(optional)" hint after the label.
          required={false}
          placeholder={t('provider.keyPlaceholder')}
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            if (error) setError(null);
          }}
          errorMessage={error ?? undefined}
        />

        {/* The label marks the field optional, so the only helper needed is
            where to get a key. */}
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
      </div>
    </WizardStep>
  );
}
