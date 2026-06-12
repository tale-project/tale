'use client';

import { Skeletonize } from '@tale/ui/skeleton-context';
import { useCallback, useState } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useT } from '@/lib/i18n/client';

import { useBranding } from '../hooks/queries';
import { BrandingForm } from './branding-form';
import { BrandingPreview, type BrandingPreviewData } from './branding-preview';

interface BrandingData {
  appName?: string;
  textLogo?: string;
  logoUrl?: string | null;
  faviconLightUrl?: string | null;
  faviconDarkUrl?: string | null;
  brandColor?: string;
  accentColor?: string;
}

// =============================================================================
// Plain presentational view — renders the real `SettingsPage` + two-column
// (form + live preview) layout. Rendered both live and (wrapped in
// `<Skeletonize>`) as its own skeleton, so the loading and loaded layouts are
// the SAME tree and cannot drift. The form's skeleton-aware leaves (Input,
// Button) auto-mask; the custom color/image controls mask via `<SkeletonBox>`
// inside `BrandingForm`. The preview pane is the SAME `<BrandingPreview>` node
// in both states (it renders neutral placeholder bars when branding is empty),
// so it reserves its exact fixed-height footprint with zero shift on load.
// =============================================================================
function BrandingSettingsView({
  organizationId,
  branding,
  onSaved,
}: {
  organizationId: string;
  branding?: BrandingData;
  onSaved?: () => void;
}) {
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');

  const [previewData, setPreviewData] = useState<BrandingPreviewData>({
    appName: branding?.appName,
    textLogo: branding?.textLogo,
    logoUrl: branding?.logoUrl,
    brandColor: branding?.brandColor,
    accentColor: branding?.accentColor,
  });

  const handlePreviewChange = useCallback((data: BrandingPreviewData) => {
    setPreviewData(data);
  }, []);

  return (
    <SettingsPage fitToContainer>
      <SettingsSection
        title={tNav('branding')}
        description={tSettings('menu.branding.description')}
        className="min-h-0 flex-1"
      >
        {/* `justify-center` centers the fixed-width form on small screens where
            the preview is hidden; it's inert on lg where the flex-1 preview fills
            the row. */}
        <div className="flex flex-1 justify-center gap-6">
          <BrandingForm
            organizationId={organizationId}
            branding={branding}
            onPreviewChange={handlePreviewChange}
            onSaved={onSaved}
          />
          <div className="hidden flex-1 lg:flex">
            <BrandingPreview data={previewData} />
          </div>
        </div>
      </SettingsSection>
    </SettingsPage>
  );
}

// =============================================================================
// Container — owns the branding read, the access check, and the loading state.
// Wraps the view in `<Skeletonize>` so the same two-column tree renders the
// skeleton (matched width + reserved preview space). The route just renders
// `<BrandingSettings />` (branding + ability both read from context, so no
// props are required).
// =============================================================================
export function BrandingSettings() {
  const { t: tAccessDenied } = useT('accessDenied');

  const organizationId = useOrganizationId();
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const brandingQuery = useBranding(organizationId);

  // Access is only knowable once the ability has loaded; until then the
  // skeleton stands in (no denied-flash on warm entry).
  if (!abilityLoading && ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={tAccessDenied('branding')} />;
  }

  // Always present under the `/dashboard/$id` route; the guard narrows the type
  // for the per-org save/upload mutations below.
  if (!organizationId) return null;

  const branding = brandingQuery.data;

  return (
    <Skeletonize loading={abilityLoading || brandingQuery.isPending}>
      <BrandingSettingsView
        organizationId={organizationId}
        branding={branding ?? undefined}
        onSaved={() => void brandingQuery.refetch()}
      />
    </Skeletonize>
  );
}
