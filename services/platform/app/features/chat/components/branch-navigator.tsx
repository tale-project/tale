'use client';

/**
 * The ‹ n/m › sibling flipper under a forked message. One compact control per
 * fork point: previous / position / next, flipping which edit or regenerate
 * sibling the conversation shows from that point on.
 */

import { Button } from '@tale/ui/button';
import { Row } from '@tale/ui/layout';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

export function BranchNavigator({
  index,
  total,
  onSelect,
}: {
  /** Zero-based position of the sibling currently shown. */
  index: number;
  total: number;
  onSelect: (index: number) => void;
}) {
  const { t } = useT('chat');
  if (total < 2) return null;

  return (
    <Row gap={0} className="text-muted-foreground mt-0.5 items-center">
      <Button
        size="icon"
        variant="ghost"
        aria-label={t('branchNavigator.previous')}
        disabled={index === 0}
        onClick={() => onSelect(index - 1)}
        className="size-5"
      >
        <ChevronLeft aria-hidden className="size-3.5" />
      </Button>
      <span className="text-xs tabular-nums">
        {index + 1}/{total}
      </span>
      <Button
        size="icon"
        variant="ghost"
        aria-label={t('branchNavigator.next')}
        disabled={index === total - 1}
        onClick={() => onSelect(index + 1)}
        className="size-5"
      >
        <ChevronRight aria-hidden className="size-3.5" />
      </Button>
    </Row>
  );
}
