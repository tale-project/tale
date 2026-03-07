'use client';

import { ChevronLeft } from 'lucide-react';
import { useEffect, useRef } from 'react';

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
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  const { data: breadcrumb, isLoading } = useConvexQuery(
    api.folders.queries.getFolderBreadcrumb,
    { folderId: toId<'folders'>(folderId) },
  );

  useEffect(() => {
    if (!isLoading && breadcrumb !== undefined && breadcrumb.length === 0) {
      onNavigateRef.current(undefined);
    }
  }, [breadcrumb, isLoading]);

  const segments = breadcrumb ?? [];

  return (
    <nav
      className="bg-background sticky top-14 z-10 mb-4"
      aria-label={t('breadcrumb.navigation')}
    >
      <ol className="flex items-center gap-1">
        <li className="flex items-center gap-1">
          <button
            onClick={() => onNavigate(undefined)}
            className="text-muted-foreground hover:text-foreground/90 focus-visible:ring-ring size-4 shrink-0 cursor-pointer rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
            aria-label={tCommon('aria.backTo', {
              page: t('breadcrumb.documents'),
            })}
          >
            <ChevronLeft className="size-4" />
          </button>

          <button
            onClick={() => onNavigate(undefined)}
            className="text-muted-foreground hover:text-foreground/90 focus-visible:ring-ring cursor-pointer rounded-sm text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            {t('breadcrumb.documents')}
          </button>
        </li>

        {segments.map((folder, index) => {
          const isLast = index === segments.length - 1;

          return (
            <li key={folder._id} className="flex items-center gap-1">
              <span
                className="text-muted-foreground mx-1 text-[14px] leading-4 font-medium"
                aria-hidden="true"
              >
                /
              </span>

              {isLast ? (
                <span
                  className="text-foreground text-xs font-semibold whitespace-nowrap"
                  aria-current="page"
                >
                  {folder.name}
                </span>
              ) : (
                <button
                  onClick={() => onNavigate(folder._id)}
                  className="text-muted-foreground hover:text-foreground/90 focus-visible:ring-ring cursor-pointer rounded-sm text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  {folder.name}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
