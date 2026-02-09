import { Image } from '@/app/components/ui/data-display/image';

export const TaleLogo = () => {
  return (
    <div className="flex size-8 items-center justify-center">
      {/* Light theme logo - hidden in dark mode via CSS */}
      <Image
        priority
        src="/assets/logo-black.svg"
        className="size-5 object-contain dark:hidden"
        alt="logo"
        width={20}
        height={20}
      />
      {/* Dark theme logo - hidden in light mode via CSS */}
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
