import { redirect } from '@tanstack/react-router';

import { FIRST_SETTINGS_PAGE } from './pages';
import { isPhoneViewport } from './viewport';

/**
 * `beforeLoad` of the Settings index. A computer has the panel beside the page,
 * so Settings opens on its first page, as the rail's Settings tile promises. A
 * phone has no panel: the index stays and lists the pages instead
 * (`SettingsIndexPage`).
 */
export function openFirstPageOnDesktop(): void {
  if (isPhoneViewport()) return;
  throw redirect({ to: FIRST_SETTINGS_PAGE.path, replace: true });
}
