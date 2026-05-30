'use client';

import { PageSection } from '@tale/ui/page-section';
import { SkeletonBox, SkeletonText } from '@tale/ui/skeleton';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';

import { ContentArea } from '@/app/components/layout/content-area';
import { FormSection } from '@/app/components/ui/forms/form-section';

/**
 * Layout-shaped skeleton for project detail tabs. Built from the SAME layout
 * primitives the real tabs use — `ContentArea variant="narrow"`,
 * `StickySectionHeader`, `PageSection` (border-top dividers), `FormSection` —
 * with masked boxes for the content. Because the wrappers are identical, the
 * skeleton inherits the exact `narrow` width/centering, the sticky header's
 * `py-3`/`-mx-4` geometry, and the `mt-8 border-t pt-8` section rhythm, so it
 * can't drift from the loaded tab.
 *
 * Modeled on the Overview tab (the eager default), which is what renders while
 * the layout-level project query resolves: header → identity form (Input +
 * Textarea) → sharing section → recent-chats list.
 *
 * Used at the route-layout level (`$projectId.tsx`) while the project query
 * resolves, and individual tabs can render it directly when their own data is
 * still pending.
 */
export function ProjectTabSkeleton() {
  return (
    <ContentArea variant="narrow" gap={6}>
      {/* Sticky header — title + description + a right-aligned action button,
          masked at the SectionHeader's natural metrics. */}
      <StickySectionHeader
        title={<SkeletonText width="12rem" className="h-6 leading-6" />}
        description={<SkeletonText width="18rem" />}
        action={<SkeletonBox className="h-8 w-28" />}
      />

      {/* Identity form section — label/description + Input + Textarea, sized
          to the real `rows={2}` textarea. */}
      <PageSection
        title={<SkeletonText width="8rem" className="h-5 leading-5" />}
        description={<SkeletonText width="20rem" />}
        gap={4}
      >
        <FormSection>
          <SkeletonBox className="h-9 w-full" />
          <SkeletonBox className="h-16 w-full" />
        </FormSection>
      </PageSection>

      {/* Divider + sharing section — a single Select control. */}
      <PageSection
        title={<SkeletonText width="8rem" className="h-5 leading-5" />}
        gap={4}
        className="mt-8 border-t pt-8"
      >
        <FormSection>
          <SkeletonBox className="h-9 w-full" />
        </FormSection>
      </PageSection>

      {/* Divider + recent-chats list — bordered rows matching the real
          `divide-y rounded-lg border` link list. */}
      <PageSection
        title={<SkeletonText width="10rem" className="h-5 leading-5" />}
        gap={3}
        className="mt-8 border-t pt-8"
      >
        <div className="divide-y rounded-lg border">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="flex items-center gap-3 px-4 py-3">
              <SkeletonBox className="size-4 shrink-0" />
              <SkeletonText width="16rem" className="flex-1" />
            </div>
          ))}
        </div>
      </PageSection>
    </ContentArea>
  );
}
