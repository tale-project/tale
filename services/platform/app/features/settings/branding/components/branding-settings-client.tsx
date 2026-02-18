'use client';

import { useCallback, useState } from 'react';

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

interface BrandingSettingsClientProps {
  organizationId: string;
  branding?: BrandingData;
}

export function BrandingSettingsClient({
  organizationId,
  branding,
}: BrandingSettingsClientProps) {
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
    <div className="flex gap-6 flex-1">
      <BrandingForm
        organizationId={organizationId}
        branding={branding}
        onPreviewChange={handlePreviewChange}
      />
      <div className="hidden flex-1 lg:flex">
        <BrandingPreview data={previewData} />
      </div>
    </div>
  );
}
