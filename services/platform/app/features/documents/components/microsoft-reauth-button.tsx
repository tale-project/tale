'use client';

import { Button } from '@tale/ui/button';
import { RefreshCw } from 'lucide-react';
import { useState, useCallback } from 'react';

import { MicrosoftIcon } from '@/app/components/icons/microsoft-icon';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { getEnv } from '@/lib/env';
import { useT } from '@/lib/i18n/client';

interface MicrosoftReauthButtonProps {
  error?: string;
  className?: string;
}

/**
 * Starts the Knowledge cloud-import OAuth for OneDrive — intentional grant
 * for Documents, independent of how the user signs into Tale.
 */
export function MicrosoftReauthButton({
  error,
  className,
}: MicrosoftReauthButtonProps) {
  const { t } = useT('documents');
  const [isLoading, setIsLoading] = useState(false);
  const organizationId = useOrganizationId();

  const handleReauth = useCallback(() => {
    if (!organizationId) return;
    setIsLoading(true);
    const siteUrl = getEnv('SITE_URL');
    const basePath = getEnv('BASE_PATH');
    const startUrl = new URL(
      `${siteUrl}${basePath}/api/cloud-import/oauth2/start`,
    );
    startUrl.searchParams.set('provider', 'onedrive');
    startUrl.searchParams.set('organizationId', organizationId);
    window.location.href = startUrl.toString();
  }, [organizationId]);

  const getButtonText = () => {
    if (error === 'ConsentRequired') {
      return t('onedrive.grantPermissions');
    }
    if (error === 'RefreshTokenError') {
      return t('onedrive.reconnect');
    }
    return t('onedrive.connect');
  };

  return (
    <Button
      onClick={handleReauth}
      disabled={isLoading || !organizationId}
      className={className}
      variant={error ? 'destructive' : 'primary'}
    >
      {error ? (
        <RefreshCw
          className={`mr-2 size-4 ${isLoading ? 'animate-spin' : ''}`}
        />
      ) : (
        <MicrosoftIcon className="mr-2 size-4" />
      )}
      {isLoading ? t('onedrive.redirecting') : getButtonText()}
    </Button>
  );
}
