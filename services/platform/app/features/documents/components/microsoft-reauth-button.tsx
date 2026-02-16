'use client';

import { RefreshCw } from 'lucide-react';
import { useState, useCallback } from 'react';

import { Button } from '@/app/components/ui/primitives/button';
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

  const handleReauth = useCallback(() => {
    setIsLoading(true);
    const callbackUri = `${window.location.origin}/http_api/api/sso/callback`;
    const authorizeUrl = `/http_api/api/sso/authorize?redirect_uri=${encodeURIComponent(callbackUri)}`;
    window.location.href = authorizeUrl;
  }, []);

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
