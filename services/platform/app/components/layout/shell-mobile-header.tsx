import type { ReactNode } from 'react';

/*
 * The phone shell's notch clearance, below its alert stack: its header pads
 * the notch, or, on a thread page whose own header sits at the top, a spacer
 * does. The standing session notice (`SessionLapseNotice`) sits above both
 * and pads the notch itself, so while the shell shows it (`.mobile-nav-shell`
 * with a `data-session-lapse-notice` child) neither pads again: a second pad
 * left a blank band as tall as the notch under the notice in an installed
 * iPhone app.
 */

/** The shell's header on a phone. */
export function ShellMobileHeader({ children }: { children: ReactNode }) {
  return (
    // Keep local header chrome above the mobile nav.
    <header className="bg-background border-border sticky top-0 z-40 border-b px-4 pt-(--safe-top) md:hidden [.mobile-nav-shell:has(>[data-session-lapse-notice])_&]:pt-0">
      {children}
    </header>
  );
}

/** The notch clearance the header would have given a thread page's own. */
export function ShellNotchSpacer() {
  return (
    <div
      aria-hidden
      className="bg-background h-(--safe-top) shrink-0 md:hidden [.mobile-nav-shell:has(>[data-session-lapse-notice])_&]:hidden"
    />
  );
}
