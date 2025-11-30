'use client';

import Image from 'next/image';
import { authClient } from '@/lib/auth-client';
import { Button } from './ui/button';
import { useEffect, useState } from 'react';

const MIN_SCREEN_WIDTH = 600;

export default function DeviceCompatibilityOverlay() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      const screenWidth =
        typeof window !== 'undefined' ? window.innerWidth : null;
      if (screenWidth === null) {
        return;
      }

      if (screenWidth < MIN_SCREEN_WIDTH) {
        setIsVisible(true);
      } else {
        setIsVisible(false);
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const handleSignOut = async () => {
    await authClient.signOut();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-background"
      style={{ display: isVisible ? 'block' : 'none' }}
    >
      <div className="flex size-full items-center justify-center">
        <div className="mx-4 max-w-[20.5rem] rounded-xl bg-background p-4 text-center">
          <div className="relative mb-6">
            <Image
              className="rounded-lg"
              src="/assets/device-compatibility.webp"
              alt="Device compatibility illustration"
              width={296}
              height={180}
            />
          </div>
          <h1 className="mb-1 text-lg font-semibold text-foreground">
            Device Not Supported
          </h1>
          <p className="text-sm text-muted-foreground mb-4">
            Please use a device with a larger screen for the best experience.
          </p>
          <Button onClick={handleSignOut} className="mx-auto">
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
}
