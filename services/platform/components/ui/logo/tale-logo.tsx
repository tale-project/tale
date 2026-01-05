'use client';

import Image from 'next/image';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export const TaleLogo = () => {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Only render after mounting to avoid hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // Return a placeholder that matches the expected size during SSR
    return (
      <div
        className="size-8 flex items-center justify-center bg-transparent"
        aria-label="Logo loading"
      />
    );
  }

  return (
    <div className="size-8 flex items-center justify-center">
      {resolvedTheme === 'light' && (
        <Image
          priority
          src="/assets/logo-black.svg"
          className="size-5 object-contain"
          alt="logo"
          width={20}
          height={20}
        />
      )}
      {resolvedTheme === 'dark' && (
        <Image
          priority
          src="/assets/logo-white.svg"
          className="size-5 object-contain"
          alt="logo"
          width={20}
          height={20}
        />
      )}
    </div>
  );
};
