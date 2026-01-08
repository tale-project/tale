'use client';

import Link from 'next/link';
import { TaleLogoText } from '@/components/ui/logo/tale-logo-text';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <div className="flex-1">
        <div className="pt-8 px-4 sm:px-8 pb-16 md:pb-32">
          <Link href="/" className="hover:opacity-70 w-fit inline-block">
            <TaleLogoText />
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}
