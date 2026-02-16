'use client';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { Field, FieldGroup } from '@/app/components/ui/forms/field';
import { HStack, Grid } from '@/app/components/ui/layout/layout';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { Doc } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

interface ViewWebsiteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  website: Doc<'websites'>;
}

export function ViewWebsiteDialog({
  isOpen,
  onClose,
  website,
}: ViewWebsiteDialogProps) {
  const { formatDate } = useFormatDate();
  const { t } = useT('websites');

  const SCAN_INTERVALS: Record<string, string> = {
    '60m': t('scanIntervals.1hour'),
    '6h': t('scanIntervals.6hours'),
    '12h': t('scanIntervals.12hours'),
    '1d': t('scanIntervals.1day'),
    '5d': t('scanIntervals.5days'),
    '7d': t('scanIntervals.7days'),
    '30d': t('scanIntervals.30days'),
  };

  return (
    <ViewDialog
      open={isOpen}
      onOpenChange={onClose}
      title={t('viewDialog.title')}
      className="max-w-2xl"
    >
      <FieldGroup gap={4}>
        <Grid cols={2} gap={4}>
          <Field label={t('viewDialog.domain')}>{website.domain}</Field>

          <Field label={t('viewDialog.status')}>
            <HStack gap={2}>
              <div
                className={`h-2 w-2 rounded-full ${
                  website.status === 'active'
                    ? 'bg-green-500'
                    : website.status === 'error'
                      ? 'bg-red-500'
                      : 'bg-gray-500'
                }`}
              />
              {website.status || t('viewDialog.unknown')}
            </HStack>
          </Field>

          <Field label={t('viewDialog.scanInterval')}>
            {SCAN_INTERVALS[website.scanInterval] || website.scanInterval}
          </Field>

          <Field label={t('viewDialog.lastScanned')}>
            {website.lastScannedAt
              ? formatDate(new Date(website.lastScannedAt), 'long')
              : t('viewDialog.notScannedYet')}
          </Field>

          <Field label={t('viewDialog.titleField')} className="col-span-2">
            {website.title || '-'}
          </Field>

          <Field label={t('viewDialog.description')} className="col-span-2">
            <span className="whitespace-pre-wrap">
              {website.description || '-'}
            </span>
          </Field>

          <Field label={t('viewDialog.created')}>
            {formatDate(new Date(website._creationTime), 'long')}
          </Field>
        </Grid>
      </FieldGroup>
    </ViewDialog>
  );
}
