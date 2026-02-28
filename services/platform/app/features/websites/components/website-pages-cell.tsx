'use client';

import { useCallback, useState } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import { ProgressBar } from '@/app/components/ui/feedback/progress-bar';
import { useT } from '@/lib/i18n/client';

import { WebsitePagesDialog } from './website-pages-dialog';

interface WebsitePagesCellProps {
  website: Doc<'websites'>;
}

export function WebsitePagesCell({ website }: WebsitePagesCellProps) {
  const { t } = useT('websites');
  const [isOpen, setIsOpen] = useState(false);

  const handleOpen = useCallback(() => setIsOpen(true), []);
  const handleClose = useCallback(() => setIsOpen(false), []);

  const crawled = website.crawledPageCount ?? 0;
  const total = website.pageCount ?? 0;
  const percentage = total > 0 ? Math.round((crawled / total) * 100) : 0;

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
            label={t('indexedTooltip', {
              percentage: String(percentage),
              crawled: String(crawled),
              total: String(total),
            })}
            tooltipContent={t('indexedTooltip', {
              percentage: String(percentage),
              crawled: String(crawled),
              total: String(total),
            })}
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
