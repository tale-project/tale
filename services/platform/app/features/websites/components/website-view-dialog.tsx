'use client';

import { useMemo } from 'react';

import {
  type StatGridItem,
  StatGrid,
} from '@/app/components/ui/data-display/stat-grid';
import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { HStack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
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

  const items = useMemo<StatGridItem[]>(() => {
    const scanIntervals: Record<string, string> = {
      '60m': t('scanIntervals.1hour'),
      '6h': t('scanIntervals.6hours'),
      '12h': t('scanIntervals.12hours'),
      '1d': t('scanIntervals.1day'),
      '5d': t('scanIntervals.5days'),
      '7d': t('scanIntervals.7days'),
      '30d': t('scanIntervals.30days'),
    };

    return [
      {
        label: t('viewDialog.domain'),
        value: <Text>{website.domain}</Text>,
      },
      {
        label: t('viewDialog.status'),
        value: (
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
            <Text>{website.status || t('viewDialog.unknown')}</Text>
          </HStack>
        ),
      },
      {
        label: t('viewDialog.scanInterval'),
        value: (
          <Text>
            {scanIntervals[website.scanInterval] || website.scanInterval}
          </Text>
        ),
      },
      {
        label: t('viewDialog.lastScanned'),
        value: (
          <Text>
            {website.lastScannedAt
              ? formatDate(new Date(website.lastScannedAt), 'long')
              : t('viewDialog.notScannedYet')}
          </Text>
        ),
      },
      {
        label: t('viewDialog.titleField'),
        value: <Text>{website.title || '-'}</Text>,
        colSpan: 2,
      },
      {
        label: t('viewDialog.description'),
        value: (
          <Text className="whitespace-pre-wrap">
            {website.description || '-'}
          </Text>
        ),
        colSpan: 2,
      },
      {
        label: t('viewDialog.created'),
        value: (
          <Text>{formatDate(new Date(website._creationTime), 'long')}</Text>
        ),
      },
    ];
  }, [website, t, formatDate]);

  return (
    <ViewDialog
      open={isOpen}
      onOpenChange={onClose}
      title={t('viewDialog.title')}
      className="max-w-2xl"
    >
      <StatGrid items={items} />
    </ViewDialog>
  );
}
