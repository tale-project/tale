import { TaleLogo } from '@tale/ui/logo';

import { useBrandingContext } from '@/app/components/branding/branding-provider';
import { Image } from '@/app/components/image';

export const TaleLogoText = () => {
  const { appName, logoUrl } = useBrandingContext();

  if (logoUrl) {
    return (
      <Image
        priority
        src={logoUrl}
        alt="logo"
        className="h-6 object-contain"
        width={74}
        height={24}
      />
    );
  }

  if (appName) {
    return (
      <span className="text-foreground text-base font-semibold tracking-tight">
        {appName}
      </span>
    );
  }

  return <TaleLogo className="text-foreground" />;
};
