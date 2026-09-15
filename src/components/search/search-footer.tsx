import { CornerDownLeft } from 'lucide-react';
import type { ReactNode } from 'react';

interface SearchFooterProps {
  resultCount: number | null;
  resultCountLabel: (count: number) => string;
  tips: { navigate: string; select: string; close: string };
}

/** Keyboard tips + live result count, pinned to the bottom of the palette. */
export function SearchFooter({
  resultCount,
  resultCountLabel,
  tips,
}: SearchFooterProps) {
  return (
    <div className="border-border-base bg-bg-elevated/40 text-fg-subtle flex items-center justify-between gap-3 border-t px-4 py-2 text-[11px]">
      <ul role="list" className="flex items-center gap-3">
        <li className="hidden items-center gap-1 sm:inline-flex">
          <FooterKey>↑</FooterKey>
          <FooterKey>↓</FooterKey>
          <span>{tips.navigate}</span>
        </li>
        <li className="inline-flex items-center gap-1">
          <FooterKey>
            <CornerDownLeft className="size-3" />
          </FooterKey>
          <span>{tips.select}</span>
        </li>
        <li className="hidden items-center gap-1 sm:inline-flex">
          <FooterKey>esc</FooterKey>
          <span>{tips.close}</span>
        </li>
      </ul>
      <span aria-live="polite" className="tabular-nums">
        {resultCount !== null ? resultCountLabel(resultCount) : null}
      </span>
    </div>
  );
}

function FooterKey({ children }: { children: ReactNode }) {
  return (
    <kbd className="border-border-base bg-bg-base text-fg-base inline-flex h-4 min-w-4 items-center justify-center rounded border px-1 font-mono text-[10px]">
      {children}
    </kbd>
  );
}
