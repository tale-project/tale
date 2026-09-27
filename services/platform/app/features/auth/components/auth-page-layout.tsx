import { cn } from '@tale/ui/cn';
import { Row, Spacer, VStack } from '@tale/ui/layout';
import type { ReactNode } from 'react';

import { STANDALONE_PAGE } from '@/app/components/layout/standalone-page';
import { LogoLink } from '@/app/components/logo/logo-link';

/** One page frame keeps the OAuth handoff and the login form in place. */
export function AuthPageLayout({
  children,
  header,
}: {
  children: ReactNode;
  header?: ReactNode;
}) {
  return (
    <VStack
      gap={0}
      align="stretch"
      className={cn('bg-background text-foreground', STANDALONE_PAGE)}
    >
      {header ?? (
        <Row
          gap={0}
          className="pt-[calc(2rem+var(--safe-top))] pr-[calc(1rem+var(--safe-right))] pb-16 pl-[calc(1rem+var(--safe-left))] sm:pr-[calc(2rem+var(--safe-right))] sm:pl-[calc(2rem+var(--safe-left))] md:pb-32"
        >
          <LogoLink href="/" />
        </Row>
      )}
      {/* The skip-link target is focused programmatically, not a control. */}
      <main id="main-content" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <Spacer />
    </VStack>
  );
}
