'use client';

import { Alert } from '@tale/ui/alert';

import { useT } from '@/lib/i18n/client';

/**
 * Why a subscription credential never serves chat, said where one is set
 * up: its tokens run only inside the vendor's own agent runtime in a
 * sandbox — the vendors permit them nowhere else, and Anthropic refuses them
 * from any other client — so tasks and automations use it, and chat needs an
 * API key or environment-variable credential. Static: it describes the
 * method, it does not announce an event.
 */
export function SubscriptionScopeNotice() {
  const { t } = useT('settings');
  return (
    <Alert
      variant="info"
      live="off"
      title={t('providers.subscriptionScope.title')}
      description={t('providers.subscriptionScope.description')}
    />
  );
}
