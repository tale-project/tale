'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

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
    const params = new URLSearchParams(searchParams.toString());
    if (targetPath) {
      params.set('folderPath', targetPath);
    } else {
      params.delete('folderPath');
    }
    const url = params.toString() ? `${pathname}?${params}` : pathname;
    router.push(url);
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
    <nav className="flex items-center gap-1 mb-4 bg-background sticky top-14 z-10">
      {/* Back Arrow */}
      <button
        onClick={() => navigateToPath('')}
        className="shrink-0 size-4 text-muted-foreground hover:text-foreground/90 transition-colors"
        aria-label={tCommon('aria.backTo', { page: t('breadcrumb.documents') })}
      >
        <ChevronLeft className="size-4" />
      </button>

      {/* Documents Root */}
      <button
        onClick={() => navigateToPath('')}
        className="font-medium text-xs text-muted-foreground hover:text-foreground/90 transition-colors whitespace-nowrap"
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
              className="font-medium text-[14px] text-muted-foreground leading-4 mx-1"
              style={{ fontFamily: 'DM Sans, sans-serif' }}
            >
              /
            </div>

            {/* Segment */}
            {isLast ? (
              <span
                className="text-xs text-foreground font-semibold whitespace-nowrap"
                style={{ fontFamily: 'Inter, sans-serif' }}
              >
                {displayName}
              </span>
            ) : (
              <button
                onClick={() => navigateToPath(segmentObj.originalPath)}
                className="font-medium text-xs text-muted-foreground hover:text-foreground/90 transition-colors whitespace-nowrap"
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
