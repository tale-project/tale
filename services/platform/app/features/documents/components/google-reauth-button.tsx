'use client';

import { Button } from '@tale/ui/button';
import { RefreshCw } from 'lucide-react';
import { useState, useCallback } from 'react';

import { GoogleIcon } from '@/app/components/icons/google-icon';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { getEnv } from '@/lib/env';
import { useT } from '@/lib/i18n/client';

interface GoogleReauthButtonProps {
  error?: string;
  className?: string;
}

/**
 * Starts Knowledge cloud-import OAuth for Google Drive.
 */
export function GoogleReauthButton({
  error,
  className,
}: GoogleReauthButtonProps) {
  const { t } = useT('documents');
  const [isLoading, setIsLoading] = useState(false);
  const organizationId = useOrganizationId();

  const handleReauth = useCallback(() => {
    if (!organizationId) return;
    setIsLoading(true);
    const siteUrl = getEnv('SITE_URL');
    const basePath = getEnv('BASE_PATH');
    const startUrl = new URL(
      `${siteUrl}${basePath}/http_api/api/cloud-import/oauth2/start`,
    );
    startUrl.searchParams.set('provider', 'google-drive');
    startUrl.searchParams.set('organizationId', organizationId);
    window.location.href = startUrl.toString();
  }, [organizationId]);

  const getButtonText = () => {
    if (error === 'ConsentRequired') {
      return t('googledrive.grantPermissions');
    }
    if (error === 'RefreshTokenError') {
      return t('googledrive.reconnect');
    }
    return t('googledrive.connect');
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
        <GoogleIcon className="mr-2 size-4" />
      )}
      {isLoading ? t('googledrive.redirecting') : getButtonText()}
    </Button>
  );
}
