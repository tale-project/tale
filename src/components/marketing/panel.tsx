import { Card } from '@tale/ui/card';
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
    <Card
      padding="none"
      radius="xl"
      className={cn('bg-surface-site-raised overflow-hidden', className)}
    >
      {children}
    </Card>
  );
}
