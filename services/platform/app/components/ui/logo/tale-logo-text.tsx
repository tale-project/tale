import { useBrandingContext } from '@/app/components/branding/branding-provider';
import { Image } from '@/app/components/ui/data-display/image';

export const TaleLogoText = () => {
  const { textLogo, logoUrl } = useBrandingContext();

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

  if (textLogo) {
    return (
      <span className="text-foreground text-base font-semibold tracking-tight">
        {textLogo}
      </span>
    );
  }

  return (
    <>
      <Image
        priority
        src="/assets/logo-text-black.svg"
        className="dark:hidden"
        alt="logo"
        width={74}
        height={24}
      />
      <Image
        priority
        src="/assets/logo-text-white.svg"
        className="hidden dark:block"
        alt="logo"
        width={74}
        height={24}
      />
    </>
  );
};
