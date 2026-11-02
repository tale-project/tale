import { useIsMobile } from '@tale/ui/use-is-mobile';
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

import { FIRST_SETTINGS_PAGE } from '../lib/pages';
import { SettingsPagesList } from './settings-pages-list';

/**
 * Settings on its own address. A phone lists the pages. A computer never stays
 * here (`openFirstPageOnDesktop` sends it on before this renders); this covers
 * the window growing past the phone breakpoint while the list is open.
 */
export function SettingsIndexPage() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isMobile) {
      void navigate({ to: FIRST_SETTINGS_PAGE.path, replace: true });
    }
  }, [isMobile, navigate]);

  return isMobile ? <SettingsPagesList /> : null;
}
