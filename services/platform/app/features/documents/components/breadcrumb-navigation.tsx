'use client';

import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { Row } from '@tale/ui/layout';
import { toast } from '@tale/ui/use-toast';
import { ChevronLeft } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';

import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useT } from '@/lib/i18n/client';

interface BreadcrumbNavigationProps {
  folderId: string;
  onNavigate: (
    folderId: string | undefined,
    options?: { replace?: boolean },
  ) => void;
}

export function BreadcrumbNavigation({
  folderId,
  onNavigate,
}: BreadcrumbNavigationProps) {
  const { t } = useT('documents');
  const { t: tCommon } = useT('common');
  const onNavigateRef = useRef(onNavigate);
  const navigationRef = useRef<HTMLElement>(null);
  const focusNavigation = useCallback(() => navigationRef.current?.focus(), []);
  onNavigateRef.current = onNavigate;

  const organizationId = useOrganizationId();
  const {
    data: breadcrumb,
    failureCount,
    isError,
    isFetching,
    isLoading,
    refetch,
  } = useBackendQuery(
    'folders/queries:getFolderBreadcrumb',
    organizationId ? { folderId: folderId, organizationId } : 'skip',
  );

  // A folder with no trail is gone (deleted, here or in another tab) or out
  // of reach: leave its address for the root, in place of it, so Back does
  // not walk into it again.
  useEffect(() => {
    if (!isLoading && breadcrumb !== undefined && breadcrumb.length === 0) {
      toast({ title: t('folderNotFound') });
      onNavigateRef.current(undefined, { replace: true });
    }
  }, [breadcrumb, isLoading, t]);

  const segments = breadcrumb ?? [];
  const readFailed = isError && breadcrumb === undefined;

  return (
    <nav
      ref={navigationRef}
      tabIndex={-1}
      className="bg-background sticky top-14 z-10 mb-4"
      aria-label={t('breadcrumb.navigation')}
    >
      {readFailed && (
        <CatalogLoadError
          failureKey={failureCount}
          onFocusLost={focusNavigation}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
          message={t('breadcrumb.loadFailed')}
        />
      )}
      <Row as="ol" gap={1}>
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

        {segments.map((folder: (typeof segments)[number], index: number) => {
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
                  aria-label={t('aria.navigateToFolder', {
                    name: folder.name,
                  })}
                >
                  {folder.name}
                </button>
              )}
            </li>
          );
        })}
      </Row>
    </nav>
  );
}
