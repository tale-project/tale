import { Card } from '@tale/ui/card';
import { Description } from '@tale/ui/description';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import { useSettingsPages } from '../hooks/use-settings-pages';

/**
 * The pages of Settings as a list of links, for a phone, which has no panel
 * beside the page: a navigation of its own, as the platform's list of the
 * settings sections is (`SettingsSectionList`,
 * `services/platform/app/features/settings/components/settings-section-list.tsx`).
 * Each row is a full-width link with its name, a few words on what it holds,
 * and a chevron.
 */
export function SettingsPagesList() {
  const { t } = useT('navigation');
  const pages = useSettingsPages();

  return (
    <nav aria-label={t('sections.settings')}>
      <Card padding="none" className="overflow-hidden">
        <ul role="list" className="divide-border divide-y">
          {pages.map(({ key, path, icon: Icon, label, summary }) => (
            <li key={key}>
              <Link
                to={path}
                className="hover:bg-muted/40 focus-visible:ring-ring flex min-h-12 items-center gap-3 px-3 py-2.5 transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset motion-reduce:transition-none"
              >
                <Icon
                  aria-hidden
                  className="text-muted-foreground size-5 shrink-0"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <Text as="span" variant="label" className="leading-tight">
                    {label}
                  </Text>
                  <Description>{summary}</Description>
                </span>
                <ChevronRight
                  aria-hidden
                  className="text-muted-foreground size-4 shrink-0"
                />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </nav>
  );
}
