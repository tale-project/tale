'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import Banner from '@/components/banner';
import { useT } from '@/lib/i18n';

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
  const { t } = useT('auth');
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
          ? t('oauth2.success.providerAuthorized')
          : t('oauth2.success.completed'),
      );
    }

    // Handle OAuth2 errors
    if (error) {
      const errorMessages: Record<string, string> = {
        missing_code: t('oauth2.errors.missingCode'),
        missing_state: t('oauth2.errors.missingState'),
        invalid_state: t('oauth2.errors.invalidState'),
        missing_provider: t('oauth2.errors.missingProvider'),
        missing_oauth2_config: t('oauth2.errors.missingOauth2Config'),
        token_exchange_failed: t('oauth2.errors.tokenExchangeFailed'),
        callback_failed: t('oauth2.errors.callbackFailed'),
        missing_parameters: t('oauth2.errors.missingParameters'),
      };

      const errorMessage =
        errorDescription ||
        errorMessages[error] ||
        t('oauth2.errors.unexpected');

      setIsVisible(true);
      setBannerType('error');
      setMessage(errorMessage);
    }
  }, [searchParams, t]);

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
