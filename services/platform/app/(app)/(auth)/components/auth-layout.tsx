'use client';

import Link from 'next/link';
import { TaleLogoText } from '@/components/ui/logo/tale-logo-text';
import { HStack } from '@/components/ui/layout';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <div className="flex-1">
        <div className="pt-8 px-4 sm:px-8 pb-16 md:pb-32">
          <Link href="/" className="group-hover:opacity-70">
            <TaleLogoText />
          </Link>
        </div>
        {children}
      </div>
      <footer className="mt-auto py-6 px-4 sm:px-8">
        <HStack gap={4} justify="center" className="text-xs text-muted-foreground">
          <HStack gap={1}>
            <span>© {new Date().getFullYear()} Tale</span>
          </HStack>
          <HStack gap={6}>
            <Link
              href="https://tale.dev/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              Privacy | Terms
            </Link>
          </HStack>
        </HStack>
      </footer>
    </div>
  );
}
