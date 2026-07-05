'use client';

import { Button } from '@tale/ui/button';
import { useNavigate } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

/** Step back from the SSO org picker to the credential login form. */
export function AuthSsoBackButton() {
  const navigate = useNavigate();
  const { t } = useT('auth');

  return (
    <Button
      type="button"
      variant="ghost"
      icon={ChevronLeft}
      className="-ml-2"
      onClick={() => {
        void navigate({
          to: '/log-in',
          search: (prev) => ({ ...prev, method: undefined }),
        });
      }}
    >
      {t('login.ssoBackToLogin')}
    </Button>
  );
}
