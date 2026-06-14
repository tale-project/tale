'use client';

import { IconButton } from '@tale/ui/icon-button';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { useCallback, useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

interface SettingsMobileBackButtonProps {
  organizationId: string;
}

/**
 * Mobile-only back chevron for settings *sub-pages*. On mobile the settings rail
 * is hidden and the dedicated overview routes (`/settings`, `/settings/personal`)
 * drive navigation, so a sub-page (e.g. `/settings/branding`) needs an explicit
 * way back to its overview list.
 *
 * Navigation is hierarchy-based, never history-based: it always returns to the
 * canonical parent overview regardless of how the user arrived (deep link, tab
 * switch, in-page navigation). Personal sub-pages (`account`, `personalization`)
 * return to the personal overview; everything else returns to the workspace
 * overview. Rendered as a child of the settings `AdaptiveHeaderRoot` so it slots
 * into the mobile top bar; `md:hidden` keeps it off the desktop header strip.
 */
export function SettingsMobileBackButton({
  organizationId,
}: SettingsMobileBackButtonProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useT('common');

  const settingsBase = `/dashboard/${organizationId}/settings`;

  // Path within the settings section, relative to its base ('' on the workspace
  // overview). `null` when we're somehow not under settings — render nothing.
  const tail = useMemo(() => {
    if (location.pathname === settingsBase) return '';
    if (location.pathname.startsWith(`${settingsBase}/`)) {
      return location.pathname.slice(settingsBase.length + 1);
    }
    return null;
  }, [location.pathname, settingsBase]);

  // The overview routes themselves are top-level on mobile — no back button.
  const isOverview = tail === '' || tail === 'personal';

  const firstSegment = tail ? tail.split('/')[0] : '';
  const isPersonalSubPage =
    firstSegment === 'account' || firstSegment === 'personalization';

  const handleBack = useCallback(() => {
    void navigate({
      to: isPersonalSubPage
        ? '/dashboard/$id/settings/personal'
        : '/dashboard/$id/settings',
      params: { id: organizationId },
    });
  }, [navigate, organizationId, isPersonalSubPage]);

  if (tail === null || isOverview) return null;

  return (
    <IconButton
      icon={ChevronLeft}
      aria-label={t('aria.back')}
      onClick={handleBack}
      className="md:hidden"
    />
  );
}
