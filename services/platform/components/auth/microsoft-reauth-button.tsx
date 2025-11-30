'use client';

import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';

interface MicrosoftReauthButtonProps {
  error?: string;
  className?: string;
}

/**
 * Button component for re-authenticating with Microsoft.
 * Shows different text based on the error type.
 */
export function MicrosoftReauthButton({
  error,
  className,
}: MicrosoftReauthButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleReauth = async () => {
    setIsLoading(true);
    try {
      // Link Microsoft account for OAuth tokens (Files.Read scope)
      await authClient.signIn.social({
        provider: 'microsoft',
        callbackURL: window.location.href,
      });
    } catch (err) {
      console.error('Re-authentication failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const getButtonText = () => {
    if (error === 'ConsentRequired') {
      return 'Grant Microsoft Permissions';
    }
    if (error === 'RefreshTokenError') {
      return 'Re-authenticate with Microsoft';
    }
    return 'Sign in with Microsoft';
  };

  return (
    <Button
      onClick={handleReauth}
      disabled={isLoading}
      className={className}
      variant={error ? 'destructive' : 'default'}
    >
      <RefreshCw className={`size-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
      {isLoading ? 'Redirecting...' : getButtonText()}
    </Button>
  );
}
