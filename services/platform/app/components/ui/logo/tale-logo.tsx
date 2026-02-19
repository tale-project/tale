import { useBrandingContext } from '@/app/components/branding/branding-provider';
import { Image } from '@/app/components/ui/data-display/image';

export const TaleLogo = () => {
  const { logoUrl } = useBrandingContext();

  if (logoUrl) {
    return (
      <div className="flex size-8 items-center justify-center">
        <Image
          priority
          src={logoUrl}
          className="size-5 object-contain"
          alt="logo"
          width={20}
          height={20}
        />
      </div>
    );
  }

  return (
    <div className="flex size-8 items-center justify-center">
      <Image
        priority
        src="/assets/logo-black.svg"
        className="size-5 object-contain dark:hidden"
        alt="logo"
        width={20}
        height={20}
      />
      <Image
        priority
        src="/assets/logo-white.svg"
        className="hidden size-5 object-contain dark:block"
        alt="logo"
        width={20}
        height={20}
      />
    </div>
  );
};
