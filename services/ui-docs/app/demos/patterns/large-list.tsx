import { Button } from '@tale/ui/button';
import { useVirtualList } from '@tale/ui/use-virtual-list';
import { Fragment, useCallback, useRef, useState } from 'react';

const ROWS = Array.from({ length: 5_000 }, (_, index) => ({
  id: `item-${index}`,
  name: `Item ${index + 1}`,
}));
const getItemKey = (index: number) => ROWS[index].id;

export default function LargeList() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const getScrollElement = useCallback(() => scrollRef.current, []);
  const list = useVirtualList({
    count: ROWS.length,
    getScrollElement,
    getItemKey,
    estimateSize: () => 40,
  });

  return (
    <div className="w-full space-y-3">
      <Button
        variant="secondary"
        onClick={() => list.scrollToIndex(ROWS.length - 1, { align: 'end' })}
      >
        Scroll to last item
      </Button>
      <div
        ref={scrollRef}
        className="border-border h-64 overflow-auto rounded-lg border"
        role="group"
        aria-label="5,000 items"
      >
        {list.items.map((item) => (
          <Fragment key={item.key}>
            {item.paddingBefore > 0 && (
              <div aria-hidden="true" style={{ height: item.paddingBefore }} />
            )}
            <div
              data-index={item.index}
              ref={list.measureElement}
              onFocusCapture={list.onFocusCapture}
              onBlurCapture={list.onBlurCapture}
            >
              <Button
                variant="ghost"
                className="h-10 w-full justify-start"
                aria-pressed={selected === item.index}
                onClick={() => setSelected(item.index)}
              >
                {ROWS[item.index].name}
              </Button>
            </div>
          </Fragment>
        ))}
        {list.paddingAfter > 0 && (
          <div aria-hidden="true" style={{ height: list.paddingAfter }} />
        )}
      </div>
      <p className="text-muted-foreground text-sm" role="status">
        {selected !== null
          ? `Selected ${ROWS[selected].name}`
          : 'Select an item.'}
      </p>
    </div>
  );
}
