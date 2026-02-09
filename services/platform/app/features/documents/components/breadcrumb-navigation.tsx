'use client';

import { useNavigate, useLocation, useSearch } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

interface BreadcrumbNavigationProps {
  currentFolderPath: string;
}

export function BreadcrumbNavigation({
  currentFolderPath,
}: BreadcrumbNavigationProps) {
  const { t } = useT('documents');
  const { t: tCommon } = useT('common');
  const navigate = useNavigate();
  const location = useLocation();
  const search = useSearch({ strict: false }) as Record<
    string,
    string | undefined
  >;

  const rawSegments = currentFolderPath
    ? currentFolderPath.split('/').filter(Boolean)
    : [];

  const pathSegments: Array<{ segment: string; originalPath: string }> = [];
  for (let i = 0; i < rawSegments.length; i++) {
    const segment = rawSegments[i];
    const nextSegment = i + 1 < rawSegments.length ? rawSegments[i + 1] : null;

    if (nextSegment === 'onedrive') {
      const combined = `${segment}/onedrive`;
      const originalPath = rawSegments.slice(0, i + 2).join('/');
      pathSegments.push({ segment: combined, originalPath });
      i++; // Skip the next segment since we combined it
    } else {
      const originalPath = rawSegments.slice(0, i + 1).join('/');
      pathSegments.push({ segment, originalPath });
    }
  }

  const navigateToPath = (targetPath: string) => {
    const newSearch = { ...search };
    if (targetPath) {
      newSearch.folderPath = targetPath;
    } else {
      delete newSearch.folderPath;
    }
    navigate({
      to: location.pathname,
      search: newSearch,
    });
  };

  // Get appropriate display name for segment
  const getSegmentInfo = (segment: string) => {
    if (segment === 'onedrive') {
      return {
        displayName: t('breadcrumb.oneDrive'),
      };
    }

    if (segment === 'uploads') {
      return {
        displayName: t('breadcrumb.uploads'),
      };
    }

    // Default for regular folders
    return {
      displayName: segment,
    };
  };

  return (
    <nav className="bg-background sticky top-14 z-10 mb-4 flex items-center gap-1">
      {/* Back Arrow */}
      <button
        onClick={() => navigateToPath('')}
        className="text-muted-foreground hover:text-foreground/90 size-4 shrink-0 cursor-pointer transition-colors"
        aria-label={tCommon('aria.backTo', { page: t('breadcrumb.documents') })}
      >
        <ChevronLeft className="size-4" />
      </button>

      {/* Documents Root */}
      <button
        onClick={() => navigateToPath('')}
        className="text-muted-foreground hover:text-foreground/90 cursor-pointer text-xs font-medium whitespace-nowrap transition-colors"
      >
        {t('breadcrumb.documents')}
      </button>

      {/* Path segments */}
      {pathSegments.map((segmentObj, index) => {
        const isLast = index === pathSegments.length - 1;
        const { displayName } = getSegmentInfo(segmentObj.segment);

        return (
          <div key={index} className="flex items-center gap-1">
            {/* Separator */}
            <div
              className="text-muted-foreground mx-1 text-[14px] leading-4 font-medium"
              style={{ fontFamily: 'DM Sans, sans-serif' }}
            >
              /
            </div>

            {/* Segment */}
            {isLast ? (
              <span
                className="text-foreground text-xs font-semibold whitespace-nowrap"
                style={{ fontFamily: 'Inter, sans-serif' }}
              >
                {displayName}
              </span>
            ) : (
              <button
                onClick={() => navigateToPath(segmentObj.originalPath)}
                className="text-muted-foreground hover:text-foreground/90 cursor-pointer text-xs font-medium whitespace-nowrap transition-colors"
                style={{ fontFamily: 'Inter, sans-serif' }}
              >
                {displayName}
              </button>
            )}
          </div>
        );
      })}
    </nav>
  );
}
