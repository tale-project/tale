import { Row } from '@tale/ui/layout';
import type { ReactNode } from 'react';

/**
 * One nudge in the shell's alert stack, above the phone header and the rail
 * (`routes/dashboard/$id.tsx`): polite (`status`), in the warning tint, its
 * words then its one link. Every dashboard-level nudge renders through it, so
 * they read the same and keep the notch rule: the stack stands under the
 * strip that clears the notch of an installed iPhone app (`shell-notch.tsx`),
 * which takes the tint of the alert right below it (`data-shell-alert`, the
 * session notice's marker too).
 */
export function ShellAlert({ children }: { children: ReactNode }) {
  return (
    <Row
      role="status"
      data-shell-alert
      gap={2}
      wrap
      className="bg-warning/10 border-warning/30 shrink-0 border-b px-4 py-3 text-sm"
    >
      {children}
    </Row>
  );
}
