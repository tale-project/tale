'use client';

import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Eye } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

/**
 * P8: top-of-page advisory shown when the viewer has neither edit nor
 * admin rights on the project, so missing CTAs aren't mistaken for bugs.
 */
export function ProjectReadOnlyBanner() {
  const { t } = useT('projects');
  return (
    <div className="border-border bg-muted/40 flex items-start gap-3 rounded-md border p-3">
      <Eye
        className="text-muted-foreground mt-0.5 size-4 shrink-0"
        aria-hidden="true"
      />
      <Stack gap={0}>
        <Text variant="label">{t('readOnlyBanner.title')}</Text>
        <Text variant="muted" className="text-sm">
          {t('readOnlyBanner.description')}
        </Text>
      </Stack>
    </div>
  );
}
