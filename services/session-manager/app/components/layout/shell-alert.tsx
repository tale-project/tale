import { Alert } from '@tale/ui/alert';
import { cn } from '@tale/ui/cn';
import type { ComponentProps } from 'react';

/**
 * One notice in the stack above the shell, in front of the rail and the page
 * (`app-frame.tsx`): a strip across the whole width, not a card inside the page.
 * Nested in `<main>` a notice pushed the page's header down while the rail
 * stayed where it was, and looked broken; above the rail every header stays on
 * the rail's line. Mirrors `services/platform/app/components/layout/shell-alert.tsx`
 * (a `border-b` strip, `shrink-0`), drawn with the library's `Alert` so that
 * it keeps its severity glyph and tint.
 */
export function ShellAlert({
  className,
  ...props
}: ComponentProps<typeof Alert>) {
  return (
    <Alert
      {...props}
      className={cn('shrink-0 rounded-none border-x-0 border-t-0', className)}
    />
  );
}
