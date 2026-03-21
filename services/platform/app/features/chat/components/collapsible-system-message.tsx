'use client';

import { ChevronDown, Info } from 'lucide-react';
import { memo, useCallback, useState } from 'react';

import { cn } from '@/lib/utils/cn';

export const CollapsibleSystemMessage = memo(function CollapsibleSystemMessage({
  content,
}: {
  content: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((prev) => !prev), []);

  const formatted = content.replace(
    /\[([A-Z][A-Z_]+)\]/g,
    (_, tag: string) => `${tag.replaceAll('_', ' ')} -`,
  );
  const lines = formatted.split('\n');
  const nonEmptyLines = lines.filter((l) => l.trim() !== '');
  const previewLines = nonEmptyLines.slice(0, 2);
  const preview = previewLines.join(' ');
  const lastPreviewIdx =
    previewLines.length > 0
      ? lines.indexOf(previewLines[previewLines.length - 1])
      : 0;
  const rest = lines
    .slice(lastPreviewIdx + 1)
    .join('\n')
    .trimStart();
  const hasMore = rest.length > 0;

  return (
    <div className="py-1" role="status">
      <div className="bg-muted/50 text-muted-foreground overflow-hidden rounded-lg text-xs">
        <button
          type="button"
          className="flex w-full items-start gap-2 px-3 py-1.5"
          onClick={toggle}
          disabled={!hasMore}
          aria-expanded={expanded}
        >
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 text-left">{preview}</span>
          {hasMore && (
            <ChevronDown
              className={cn(
                'mt-0.5 ml-auto size-3.5 shrink-0 transition-transform',
                expanded && 'rotate-180',
              )}
            />
          )}
        </button>
        {expanded && (
          <div className="border-muted max-h-60 overflow-y-auto border-t px-3 py-2 whitespace-pre-wrap">
            {rest}
          </div>
        )}
      </div>
    </div>
  );
});
