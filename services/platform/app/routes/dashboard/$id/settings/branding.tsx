import { createFileRoute } from '@tanstack/react-router';

import { BrandingSettings } from '@/app/features/settings/branding/components/branding-settings';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/branding')({
  head: () => ({
    meta: seo('branding'),
  }),
  component: BrandingSettingsPage,
});

function BrandingSettingsPage() {
  // The container owns the branding read, access check, and loading state, and
  // wraps the real two-column (form + live preview) layout in `<Skeletonize>` —
  // so the skeleton IS that layout (matched width, reserved preview space).
  return <BrandingSettings />;
}
