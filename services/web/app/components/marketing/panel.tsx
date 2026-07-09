import { cn } from '@tale/ui/cn';
import type { ReactNode } from 'react';

interface MarketingPanelProps {
  children: ReactNode;
  className?: string;
}

/**
 * Framed marketing panel — one bordered surface for divider grids
 * (modules, capabilities, related). Matches ComplianceTrust's single-panel
 * language instead of floating per-cell cards.
 */
export function MarketingPanel({ children, className }: MarketingPanelProps) {
  return (
    <div
      className={cn(
        'border-border-base bg-surface-site-raised overflow-hidden rounded-xl border',
        className,
      )}
    >
      {children}
    </div>
  );
}
