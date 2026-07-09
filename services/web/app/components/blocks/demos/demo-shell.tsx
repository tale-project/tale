import { cn } from '@tale/ui/cn';
import { TaleLogo } from '@tale/ui/logo';
import type { ReactNode } from 'react';

export interface DemoShellProps {
  /** Localized one-sentence description of what the demo shows. */
  label: string;
  /** Localized window-title text shown in the chrome bar. */
  title: string;
  /**
   * Sizing classes — include an `aspect-*` utility so the box is reserved
   * before any content mounts (CLS 0). Defaults to `aspect-[16/10]`.
   */
  className?: string;
  children: ReactNode;
}

/**
 * Stylized app-window frame every product demo renders inside. The frame is
 * one labelled image for assistive tech (`role="img"` + `aria-label`); the
 * animated UI inside is presentational and stays out of the accessibility
 * tree and the markdown artifacts (`aria-hidden`).
 */
export function DemoShell({
  label,
  title,
  className,
  children,
}: DemoShellProps) {
  return (
    <figure
      role="img"
      aria-label={label}
      className={cn(
        'border-border-base bg-surface-site-raised m-0 w-full overflow-hidden rounded-2xl border shadow-sm aspect-[16/10]',
        className,
      )}
    >
      <div aria-hidden className="flex h-full flex-col">
        <div className="border-border-base bg-surface-site flex shrink-0 items-center gap-2.5 border-b px-4 py-2.5">
          <TaleLogo className="h-3.5 w-auto" />
          <span className="text-fg-subtle text-xs">{title}</span>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </figure>
  );
}
