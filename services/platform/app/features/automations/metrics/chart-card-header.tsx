'use client';

import { Info } from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Text } from '@/app/components/ui/typography/text';

interface ChartCardHeaderProps {
  title: string;
  tooltip?: string;
}

export function ChartCardHeader({ title, tooltip }: ChartCardHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Text as="h3" className="text-sm font-semibold">
        {title}
      </Text>
      {tooltip ? (
        <Tooltip content={tooltip} side="top">
          <button
            type="button"
            aria-label={tooltip}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex h-6 w-6 items-center justify-center rounded focus-visible:ring-2 focus-visible:outline-none"
          >
            <Info className="h-4 w-4" aria-hidden />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}
