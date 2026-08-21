'use client';

import { Button } from '@tale/ui/button';
import { Text } from '@tale/ui/text';
import { useLayoutEffect, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

/**
 * A declared settings form's operator instructions, clamped to a few lines
 * with a Show more toggle. Pack authors write whole handbooks into
 * `description`, and the first-time setup gate stacks several forms — so
 * unclamped prose buries the very fields it explains.
 */
export function SettingsFormDescription({ text }: { text: string }) {
  const { t } = useT('automations');
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const bodyRef = useRef<HTMLElement | null>(null);

  // Measure the clamp only while clamped — once expanded, scrollHeight equals
  // clientHeight and would read as "fits", hiding the Show less toggle. The
  // ResizeObserver re-measures on container reflow (dialog resize): text that
  // fit at one width can overflow at another.
  useLayoutEffect(() => {
    if (expanded) return undefined;
    const el = bodyRef.current;
    if (!el) return undefined;
    const measure = () => setOverflowing(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, text]);

  return (
    <div className="flex flex-col items-start">
      <Text
        as="p"
        variant="muted"
        ref={bodyRef}
        className={cn(!expanded && 'line-clamp-3')}
      >
        {text}
      </Text>
      {(overflowing || expanded) && (
        <Button
          // Rendered inside the settings <form>: an implicit type="submit"
          // here would save on toggle.
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setExpanded((value) => !value)}
          className="text-muted-foreground -ml-2 h-6 px-2 text-xs"
        >
          {expanded ? t('settings.showLess') : t('settings.showMore')}
        </Button>
      )}
    </div>
  );
}
