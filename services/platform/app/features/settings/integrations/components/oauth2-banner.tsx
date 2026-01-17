'use client';

import { useState, useEffect } from 'react';
import { useSearch, useNavigate, useLocation } from '@tanstack/react-router';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { Banner } from '@/app/components/ui/feedback/banner';
import { useT } from '@/lib/i18n/client';

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
  const search = useSearch({ strict: false }) as Record<string, string | undefined>;
  const navigate = useNavigate();
  const location = useLocation();
  const [isVisible, setIsVisible] = useState(false);
  const [bannerType, setBannerType] = useState<'success' | 'error'>('success');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const oauth2Status = search.oauth2;
    const error = search.email_error;
    const errorDescription = search.description;
    const providerId = search.provider;

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
  }, [search, t]);

  const handleDismiss = () => {
    setIsVisible(false);

    // Clear URL parameters
    const newSearch = { ...search };
    delete newSearch.oauth2;
    delete newSearch.email_error;
    delete newSearch.description;
    delete newSearch.provider;

    navigate({
      to: location.pathname,
      search: newSearch,
      replace: true,
    });
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
