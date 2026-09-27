'use client';

import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Archive, Eye } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

/**
 * P8: top-of-page advisory shown when the project is read-only for the
 * viewer, so missing CTAs aren't mistaken for bugs. Two reasons: the viewer
 * has neither edit nor admin rights (`viewer`, the default), or the project
 * is archived (`archived` — read-only for everyone until it is restored).
 */
export function ProjectReadOnlyBanner({
  reason = 'viewer',
}: {
  reason?: 'viewer' | 'archived';
}) {
  const { t } = useT('projects');
  const Icon = reason === 'archived' ? Archive : Eye;
  return (
    <Row
      gap={3}
      align="start"
      className="border-border bg-muted/40 rounded-md border p-3"
    >
      <Icon
        className="text-muted-foreground mt-0.5 size-4 shrink-0"
        aria-hidden="true"
      />
      <Stack gap={0}>
        <Text variant="label">
          {t(
            reason === 'archived'
              ? 'readOnlyBanner.archivedTitle'
              : 'readOnlyBanner.title',
          )}
        </Text>
        <Text variant="muted" className="text-sm">
          {t(
            reason === 'archived'
              ? 'readOnlyBanner.archivedDescription'
              : 'readOnlyBanner.description',
          )}
        </Text>
      </Stack>
    </Row>
  );
}
