'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import Banner from '@/components/banner';

/**
 * OAuth2Banner Component
 *
 * Displays a banner notification based on OAuth2 callback URL parameters.
 * Shows success banner for successful auth, error banner for failures.
 *
 * Handles:
 * - ?oauth2=success - Success notification
 * - ?oauth2=success&provider=<id> - Success with provider ID
 * - ?email_error=<type> - Error notifications
 * - ?email_error=<type>&description=<desc> - Error with description
 */
export function OAuth2Banner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isVisible, setIsVisible] = useState(false);
  const [bannerType, setBannerType] = useState<'success' | 'error'>('success');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const oauth2Status = searchParams.get('oauth2');
    const error = searchParams.get('email_error');
    const errorDescription = searchParams.get('description');
    const providerId = searchParams.get('provider');

    // Handle OAuth2 success
    if (oauth2Status === 'success') {
      setIsVisible(true);
      setBannerType('success');
      setMessage(
        providerId
          ? 'Email provider has been authorized and is ready to use.'
          : 'OAuth2 authorization completed successfully.',
      );
    }

    // Handle OAuth2 errors
    if (error) {
      const errorMessages: Record<string, string> = {
        missing_code: 'No authorization code received from the provider.',
        missing_state: 'Missing state parameter in callback.',
        invalid_state: 'Invalid state parameter. This may be a security issue.',
        missing_provider:
          'The email provider configuration could not be found.',
        missing_oauth2_config:
          'OAuth2 configuration is missing for this provider.',
        token_exchange_failed:
          'Failed to exchange authorization code for access tokens.',
        callback_failed:
          'An error occurred while processing the OAuth2 callback.',
        missing_parameters:
          'Required parameters are missing from the callback.',
      };

      const errorMessage =
        errorDescription ||
        errorMessages[error] ||
        'An unexpected error occurred during authorization.';

      setIsVisible(true);
      setBannerType('error');
      setMessage(errorMessage);
    }
  }, [searchParams]);

  const handleDismiss = () => {
    setIsVisible(false);

    // Clear URL parameters
    const newSearchParams = new URLSearchParams(searchParams.toString());
    newSearchParams.delete('oauth2');
    newSearchParams.delete('email_error');
    newSearchParams.delete('description');
    newSearchParams.delete('provider');

    const newUrl = newSearchParams.toString()
      ? `${pathname}?${newSearchParams.toString()}`
      : pathname;

    router.replace(newUrl);
  };

  const isSuccess = bannerType === 'success';

  return (
    <Banner
      isHidden={!isVisible}
      variant={isSuccess ? 'success' : 'error'}
      message={message}
      icon={isSuccess ? CheckCircle2 : AlertCircle}
      onClose={handleDismiss}
      className="mb-6"
    />
  );
}
