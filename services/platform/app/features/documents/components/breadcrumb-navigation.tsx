'use client';

import { ChevronLeft } from 'lucide-react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';

interface BreadcrumbNavigationProps {
  folderId: string;
  onNavigate: (folderId: string | undefined) => void;
}

export function BreadcrumbNavigation({
  folderId,
  onNavigate,
}: BreadcrumbNavigationProps) {
  const { t } = useT('documents');
  const { t: tCommon } = useT('common');

  const { data: breadcrumb } = useConvexQuery(
    api.folders.queries.getFolderBreadcrumb,
    { folderId: toId<'folders'>(folderId) },
  );

  const segments = breadcrumb ?? [];

  return (
    <nav className="bg-background sticky top-14 z-10 mb-4 flex items-center gap-1">
      <button
        onClick={() => onNavigate(undefined)}
        className="text-muted-foreground hover:text-foreground/90 size-4 shrink-0 cursor-pointer transition-colors"
        aria-label={tCommon('aria.backTo', { page: t('breadcrumb.documents') })}
      >
        <ChevronLeft className="size-4" />
      </button>

      <button
        onClick={() => onNavigate(undefined)}
        className="text-muted-foreground hover:text-foreground/90 cursor-pointer text-xs font-medium whitespace-nowrap transition-colors"
      >
        {t('breadcrumb.documents')}
      </button>

      {segments.map((folder, index) => {
        const isLast = index === segments.length - 1;

        return (
          <div key={folder._id} className="flex items-center gap-1">
            <div
              className="text-muted-foreground mx-1 text-[14px] leading-4 font-medium"
              style={{ fontFamily: 'DM Sans, sans-serif' }}
              aria-hidden="true"
            >
              /
            </div>

            {isLast ? (
              <span
                className="text-foreground text-xs font-semibold whitespace-nowrap"
                style={{ fontFamily: 'Inter, sans-serif' }}
                aria-current="page"
              >
                {folder.name}
              </span>
            ) : (
              <button
                onClick={() => onNavigate(folder._id)}
                className="text-muted-foreground hover:text-foreground/90 cursor-pointer text-xs font-medium whitespace-nowrap transition-colors"
                style={{ fontFamily: 'Inter, sans-serif' }}
              >
                {folder.name}
              </button>
            )}
          </div>
        );
      })}
    </nav>
  );
}
