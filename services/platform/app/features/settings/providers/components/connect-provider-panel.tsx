'use client';

import { Button } from '@tale/ui/button';
import { useState } from 'react';

import { Input } from '@/app/components/ui/forms/input';
import { useT } from '@/lib/i18n/client';

import {
  useFetchProviderModels,
  useSaveProviderSecret,
} from '../hooks/mutations';

interface ConnectProviderPanelProps {
  organizationId: string;
  providerName: string;
  /** Friendly name for labels; falls back to the slug. */
  displayName?: string;
  /** The provider's API base; used to probe the key before saving. */
  baseUrl?: string;
  /** Fired once the key is validated + saved. */
  onConnected: () => void;
}

/**
 * Inline "enter a provider API key" panel — the provider analogue of
 * `ConnectIntegrationPanel`. Probes the key against the provider's `/models`
 * endpoint (so an invalid key fails before we persist), then saves it. Reuses
 * the same `useFetchProviderModels` + `useSaveProviderSecret` flow the onboarding
 * OpenRouter step uses, so an app-install wizard step can connect any configured
 * provider without leaving the dialog.
 */
export function ConnectProviderPanel({
  organizationId,
  providerName,
  displayName,
  baseUrl,
  onConnected,
}: ConnectProviderPanelProps) {
  const { t } = useT('automations');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { mutateAsync: fetchModels } = useFetchProviderModels();
  const { mutateAsync: saveSecret } = useSaveProviderSecret();

  const label = displayName ?? providerName;

  const connect = async () => {
    const key = apiKey.trim();
    if (!key) return;
    setError(null);
    setBusy(true);
    try {
      // Probe first so a bad key surfaces here, not at agent run time.
      if (baseUrl) {
        await fetchModels({ organizationId, baseUrl, apiKey: key });
      }
      await saveSecret({ organizationId, providerName, apiKey: key });
      onConnected();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('installWizard.providerConnectFailed'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Input
        id={`provider-key-${providerName}`}
        type="password"
        label={t('installWizard.providerKeyLabel', { provider: label })}
        placeholder="••••••••"
        value={apiKey}
        onChange={(e) => {
          setApiKey(e.target.value);
          if (error) setError(null);
        }}
        errorMessage={error ?? undefined}
      />
      <div className="flex justify-end">
        <Button
          onClick={() => void connect()}
          disabled={busy || apiKey.trim().length === 0}
          isLoading={busy}
        >
          {t('installWizard.connectProvider', { provider: label })}
        </Button>
      </div>
    </div>
  );
}
