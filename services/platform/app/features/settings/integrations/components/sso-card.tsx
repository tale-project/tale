'use client';

import { KeyRound } from 'lucide-react';
import { useState } from 'react';

import type { SsoProvider } from '@/lib/shared/schemas/sso_providers';

import { useT } from '@/lib/i18n/client';

import { IntegrationCard } from './integration-card';
import { SSOConfigDialog } from './sso-config-dialog';

interface SSOCardProps {
  organizationId: string;
  ssoProvider: SsoProvider | null;
  onConfigured?: () => void;
}

export function SSOCard({
  organizationId,
  ssoProvider,
  onConfigured,
}: SSOCardProps) {
  const { t } = useT('settings');
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const isConnected = !!ssoProvider;

  const handleDialogClose = (open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      onConfigured?.();
    }
  };

  return (
    <>
      <IntegrationCard
        title={t('integrations.sso.name')}
        description={t('integrations.sso.description')}
        isActive={isConnected}
        icon={KeyRound}
        onClick={() => setIsDialogOpen(true)}
      />

      <SSOConfigDialog
        open={isDialogOpen}
        onOpenChange={handleDialogClose}
        organizationId={organizationId}
        existingProvider={ssoProvider}
      />
    </>
  );
}
