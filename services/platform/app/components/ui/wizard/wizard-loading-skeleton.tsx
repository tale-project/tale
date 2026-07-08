'use client';

import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';

/**
 * The install / setup wizard's loading placeholder, shown while the step list
 * and install-preflight snapshot resolve. Granular by design — a segmented step
 * rail over a title + content block — so the shape reads as "a wizard is
 * loading" rather than one undifferentiated block of text lines.
 */
export function WizardLoadingSkeleton() {
  return (
    <Skeletonize loading className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonBox key={i} fullWidth>
            <div className="h-1.5 w-full rounded-full" />
          </SkeletonBox>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <SkeletonBox>
          <div className="h-4 w-40 rounded" />
        </SkeletonBox>
        <SkeletonBox fullWidth>
          <div className="h-24 w-full rounded-lg" />
        </SkeletonBox>
      </div>
    </Skeletonize>
  );
}
