'use client';

import Image from 'next/image';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export const TaleLogoText = () => {
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
        style={{ width: 36, height: 36 }}
        className="bg-transparent rounded-md"
        aria-label="Logo loading"
      />
    );
  }

  return (
    <>
      {resolvedTheme === 'light' && (
        <Image
          priority
          src="/assets/logo-text-black.svg"
          alt="logo"
          width={74}
          height={24}
        />
      )}
      {resolvedTheme === 'dark' && (
        <Image
          priority
          src="/assets/logo-text-white.svg"
          alt="logo"
          width={74}
          height={24}
        />
      )}
    </>
  );
};
