'use client';

import { Button } from '@tale/ui/button';
import { RefreshCw } from 'lucide-react';
import { useState, useCallback } from 'react';

import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { getEnv } from '@/lib/env';
import { useT } from '@/lib/i18n/client';

interface MicrosoftReauthButtonProps {
  error?: string;
  className?: string;
}

/**
 * Button component for re-authenticating with Microsoft via SSO.
 * Redirects to the SSO login flow to get fresh OneDrive access tokens.
 */
export function MicrosoftReauthButton({
  error,
  className,
}: MicrosoftReauthButtonProps) {
  const { t } = useT('auth');
  const [isLoading, setIsLoading] = useState(false);
  const organizationId = useOrganizationId();

  const handleReauth = useCallback(() => {
    setIsLoading(true);
    const siteUrl = getEnv('SITE_URL');
    const basePath = getEnv('BASE_PATH');
    const callbackUri = `${siteUrl}${basePath}/http_api/api/sso/callback`;
    const authorizeUrl = new URL(
      `${siteUrl}${basePath}/http_api/api/sso/authorize`,
    );
    authorizeUrl.searchParams.set('redirect_uri', callbackUri);
    // This button lives inside the dashboard, so the org is always known —
    // pin the connection instead of relying on the single-enabled fallback
    // (which is ambiguous on multi-org deployments).
    if (organizationId) {
      authorizeUrl.searchParams.set('organizationId', organizationId);
    }
    window.location.href = authorizeUrl.toString();
  }, [organizationId]);

  const getButtonText = () => {
    if (error === 'ConsentRequired') {
      return t('microsoft.grantPermissions');
    }
    if (error === 'RefreshTokenError') {
      return t('microsoft.reauthenticate');
    }
    return t('microsoft.signIn');
  };

  return (
    <Button
      onClick={handleReauth}
      disabled={isLoading}
      className={className}
      variant={error ? 'destructive' : 'primary'}
    >
      <RefreshCw className={`mr-2 size-4 ${isLoading ? 'animate-spin' : ''}`} />
      {isLoading ? t('microsoft.redirecting') : getButtonText()}
    </Button>
  );
}
