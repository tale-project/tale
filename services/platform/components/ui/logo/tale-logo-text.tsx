import Image from 'next/image';

export const TaleLogoText = () => {
  return (
    <>
      {/* Light theme logo - hidden in dark mode via CSS */}
      <Image
        priority
        src="/assets/logo-text-black.svg"
        className="dark:hidden"
        alt="logo"
        width={74}
        height={24}
      />
      {/* Dark theme logo - hidden in light mode via CSS */}
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
