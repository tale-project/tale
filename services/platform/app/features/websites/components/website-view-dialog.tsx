'use client';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { Stack, HStack, Grid } from '@/app/components/ui/layout/layout';
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
      <Stack gap={4}>
        <Grid cols={2} gap={4}>
          <div>
            <Label>{t('viewDialog.domain')}</Label>
            <Value>{website.domain}</Value>
          </div>

          <div>
            <Label>{t('viewDialog.status')}</Label>
            <Value>
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
            </Value>
          </div>

          <div>
            <Label>{t('viewDialog.scanInterval')}</Label>
            <Value>
              {SCAN_INTERVALS[website.scanInterval] || website.scanInterval}
            </Value>
          </div>

          <div>
            <Label>{t('viewDialog.lastScanned')}</Label>
            <Value>
              {website.lastScannedAt
                ? formatDate(new Date(website.lastScannedAt), 'long')
                : t('viewDialog.notScannedYet')}
            </Value>
          </div>

          <div className="col-span-2">
            <Label>{t('viewDialog.titleField')}</Label>
            <Value>{website.title || '-'}</Value>
          </div>

          <div className="col-span-2">
            <Label>{t('viewDialog.description')}</Label>
            <Value className="whitespace-pre-wrap">
              {website.description || '-'}
            </Value>
          </div>

          <div>
            <Label>{t('viewDialog.created')}</Label>
            <Value>{formatDate(new Date(website._creationTime), 'long')}</Value>
          </div>
        </Grid>
      </Stack>
    </ViewDialog>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground mb-1 text-xs font-medium">
      {children}
    </div>
  );
}

function Value({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`text-foreground text-sm ${className || ''}`}>
      {children}
    </div>
  );
}
