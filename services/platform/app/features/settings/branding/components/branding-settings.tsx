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

interface BrandingSettingsProps {
  branding?: BrandingData;
  onSaved?: () => void;
}

export function BrandingSettings({ branding, onSaved }: BrandingSettingsProps) {
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
    <div className="flex flex-1 gap-6">
      <BrandingForm
        branding={branding}
        onPreviewChange={handlePreviewChange}
        onSaved={onSaved}
      />
      <div className="hidden flex-1 lg:flex">
        <BrandingPreview data={previewData} />
      </div>
    </div>
  );
}
