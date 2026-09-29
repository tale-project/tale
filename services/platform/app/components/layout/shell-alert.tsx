import { Row } from '@tale/ui/layout';
import type { ReactNode } from 'react';

/**
 * One nudge in the shell's alert stack, above the phone header and the rail
 * (`routes/dashboard/$id.tsx`): polite (`status`), in the warning tint, its
 * words then its one link. Every dashboard-level nudge renders through it, so
 * they read the same and keep the notch rule: whichever alert stands first
 * pads the notch of an installed iPhone app, as the session notice does, and
 * while any alert stands (`data-shell-alert`) the shell's header and a thread
 * page's spacer drop their own pad (`shell-mobile-header.tsx`).
 */
export function ShellAlert({ children }: { children: ReactNode }) {
  return (
    <Row
      role="status"
      data-shell-alert
      gap={2}
      wrap
      className="bg-warning/10 border-warning/30 shrink-0 border-b px-4 py-3 text-sm first:pt-[calc(0.75rem+var(--safe-top))]"
    >
      {children}
    </Row>
  );
}
