'use client';

import { FileText } from 'lucide-react';
import { useCallback, useState } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

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

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1.5 text-xs transition-colors"
        aria-label={t('viewPages')}
      >
        <FileText className="size-3.5" />
        <span className="underline-offset-2 hover:underline">
          {website.pageCount != null
            ? t(website.pageCount === 1 ? 'pageCountOne' : 'pageCount', {
                count: website.pageCount,
              })
            : t('viewPages')}
        </span>
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
