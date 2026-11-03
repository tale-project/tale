import { SectionNavPanel, SectionNavRow } from '@tale/ui/section-nav';
import { useRouterState } from '@tanstack/react-router';

import { useT } from '@/lib/i18n/client';

import { useSettingsPages } from '../hooks/use-settings-pages';
import { pageAt } from '../lib/pages';

/**
 * The section panel: the pages of Settings as icon rows beside the page, with
 * one highlight that glides to the open one. Hidden below `md`, where the
 * index lists the pages instead (`SettingsPagesList`). Mirrors `SettingsRail`
 * of the platform (`features/settings/components/settings-rail.tsx`).
 */
export function SettingsPanel() {
  const { t } = useT('navigation');
  const { t: tSettings } = useT('settings');
  const pages = useSettingsPages();
  // The location, not the page the outlet shows: the highlight answers a click
  // at once, while the header waits for the page.
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const activePath = pageAt(pathname)?.path ?? null;

  return (
    <SectionNavPanel
      title={t('sections.settings')}
      ariaLabel={tSettings('nav.label')}
      activeKey={activePath}
    >
      <ul className="flex flex-col gap-0.5">
        {pages.map((page) => (
          <SectionNavRow
            key={page.key}
            href={page.path}
            label={page.label}
            icon={page.icon}
            active={page.path === activePath}
          />
        ))}
      </ul>
    </SectionNavPanel>
  );
}
