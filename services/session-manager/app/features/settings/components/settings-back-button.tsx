import { IconButton } from '@tale/ui/icon-button';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

/**
 * Back to the list of pages, on a phone, from a page. A phone has no panel to
 * choose another page in. The way back is the section's list, never the
 * history, so it is the same wherever the person came from. Mirrors
 * `SettingsMobileBackButton` of the platform
 * (`services/platform/app/features/settings/components/settings-mobile-back-button.tsx`):
 * the dense icon square, in the header beside the title, on a phone only.
 */
export function SettingsBackButton() {
  const { t } = useT('common');
  const navigate = useNavigate();
  return (
    <IconButton
      icon={ArrowLeft}
      iconSize={5}
      size="sm"
      aria-label={t('aria.back')}
      onClick={() => void navigate({ to: '/settings' })}
      className="-ml-1.5 md:hidden"
    />
  );
}
