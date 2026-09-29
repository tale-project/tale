import type { ReactNode } from 'react';

/**
 * The shell's header on a phone, below its alert stack. It leaves the notch
 * to the strip that heads the shell (`shell-notch.tsx`): padded here, the
 * notch went to whichever alert stood above, a pad that moved between them
 * as alerts came and went.
 */
export function ShellMobileHeader({ children }: { children: ReactNode }) {
  return (
    // Keep local header chrome above the mobile nav.
    <header className="bg-background border-border sticky top-0 z-40 border-b px-4 md:hidden">
      {children}
    </header>
  );
}
