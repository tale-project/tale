'use client';

import { ProgressBar } from '@tale/ui/progress-bar';
import { useCallback, useState } from 'react';

import type { WebsiteDoc } from '@/app/lib/backend/contract/docs';
import { useT } from '@/lib/i18n/client';

import { WebsitePagesDialog } from './website-pages-dialog';

interface WebsitePagesCellProps {
  website: WebsiteDoc;
}

export function WebsitePagesCell({ website }: WebsitePagesCellProps) {
  const { t } = useT('websites');
  const [isOpen, setIsOpen] = useState(false);

  const handleOpen = useCallback(() => setIsOpen(true), []);
  const handleClose = useCallback(() => setIsOpen(false), []);

  const crawled = website.crawledPageCount ?? 0;
  const total = website.pageCount ?? 0;
  const percentage = total > 0 ? Math.round((crawled / total) * 100) : 0;
  const indexedLabel = t('indexedTooltip', {
    percentage: String(percentage),
    crawled: String(crawled),
    total: String(total),
  });

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="w-full cursor-pointer"
        aria-label={t('viewPages')}
      >
        {total > 0 ? (
          <ProgressBar
            value={crawled}
            max={total}
            label={indexedLabel}
            tooltipContent={indexedLabel}
          />
        ) : (
          <span className="text-muted-foreground text-xs">
            {t('viewPages')}
          </span>
        )}
      </button>

      {isOpen && (
        <WebsitePagesDialog
          isOpen={isOpen}
          onClose={handleClose}
          websiteId={website._id}
          websiteDomain={website.domain}
        />
      )}
    </>
  );
}
