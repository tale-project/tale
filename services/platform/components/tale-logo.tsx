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
          src="/assets/logo-black.svg"
          className="py-[0.19rem] px-[0.28rem] size-8"
          alt="logo"
          width={32}
          height={32}
        />
      )}
      {resolvedTheme === 'dark' && (
        <Image
          priority
          src="/assets/logo-white.svg"
          className="py-[0.19rem] px-[0.28rem] size-8"
          alt="logo"
          width={32}
          height={32}
        />
      )}
    </>
  );
};
