import { cn } from '@tale/ui/cn';
import { IconButton } from '@tale/ui/icon-button';
import { Input } from '@tale/ui/input';
import { ArrowLeft, ArrowRight, RotateCw } from 'lucide-react';
import {
  useEffect,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { useT } from '@/lib/i18n/client';

import { useAddressShortcut } from '../hooks/use-address-shortcut';
import { shownAddress } from '../lib/tab-label';
import { TOUCH_REACH } from '../lib/touch';

/** How long what was typed stays in the bar while the page it opens has not come. */
export const TYPED_ADDRESS_MS = 5000;

export type HistoryAction = 'back' | 'forward' | 'reload';

interface AddressBarProps {
  /** The address of the tab being looked at. */
  activeUrl: string | undefined;
  /** The connection is not live. */
  disabled: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onNavigate: (action: HistoryAction) => void;
  /** An address, or words to search for: the server decides which. */
  onSubmit: (text: string) => void;
  /** The bar is done with the keyboard: it goes back to the page. */
  onLeave: () => void;
  /** What sits at the end of the bar. */
  children?: ReactNode;
  className?: string;
}

interface Typed {
  text: string;
  /** The address of the tab when it was typed. */
  from: string | undefined;
}

/**
 * Back, forward and reload, and the address of the tab being looked at.
 * Typing an address opens that page, anything else is searched for. What was
 * typed stays in the bar until the page it opens arrives (a slow page would
 * otherwise show the old address, as if nothing happened). Escape gives up
 * and gives the keyboard back to the page.
 */
export function AddressBar({
  activeUrl,
  disabled,
  inputRef,
  onNavigate,
  onSubmit,
  onLeave,
  children,
  className,
}: AddressBarProps) {
  const { t } = useT('viewer');
  const shortcut = useAddressShortcut();
  // What is being edited; null while the bar has not the keyboard.
  const [draft, setDraft] = useState<string | null>(null);
  const [typed, setTyped] = useState<Typed | null>(null);
  const shown = shownAddress(activeUrl, typed);

  useEffect(() => {
    if (typed === null) return undefined;
    const timer = setTimeout(() => setTyped(null), TYPED_ADDRESS_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  // The tab went somewhere else (the page arrived, or another tab): what was
  // typed is of no use any more, also if the tab comes back to its address.
  if (typed !== null && typed.from !== activeUrl) setTyped(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = (draft ?? shown).trim();
    if (text === '') return;
    setTyped({ text, from: activeUrl });
    setDraft(null);
    onSubmit(text);
    onLeave();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return;
    setTyped(null);
    setDraft(null);
    onLeave();
  };

  const navigation = [
    { action: 'back', icon: ArrowLeft, label: t('address.back') },
    { action: 'forward', icon: ArrowRight, label: t('address.forward') },
    { action: 'reload', icon: RotateCw, label: t('address.reload') },
  ] as const;

  return (
    // One row at every width: the buttons, the address in the room that is left, and what sits at its end.
    <div className={cn('flex items-center gap-1', className)}>
      <div className="flex shrink-0 items-center gap-1">
        {navigation.map(({ action, icon, label }) => (
          <IconButton
            key={action}
            icon={icon}
            aria-label={label}
            disabled={disabled}
            onClick={() => onNavigate(action)}
            className={TOUCH_REACH}
          />
        ))}
      </div>
      <form onSubmit={submit} className="group relative ml-1 min-w-0 flex-1">
        <Input
          ref={inputRef}
          type="text"
          aria-label={t('address.label')}
          placeholder={t('address.placeholder')}
          value={draft ?? shown}
          disabled={disabled}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          wideControl
          className="pointer-fine:@md/toolbar:pr-14"
          onFocus={(event) => {
            setDraft(shown);
            event.currentTarget.select();
          }}
          onBlur={() => setDraft(null)}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {/* The way out of the page, where the person looks for it (the hint of `docs-search-trigger.tsx`). The screen reader is told in the sentence the page itself carries. */}
        <kbd
          aria-hidden="true"
          className="border-border/80 bg-muted/30 text-muted-foreground pointer-events-none absolute inset-y-0 right-3 my-auto hidden h-5 shrink-0 items-center rounded border px-1 font-mono text-[10px] group-focus-within:hidden pointer-fine:@md/toolbar:inline-flex"
        >
          {shortcut.label}
        </kbd>
      </form>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}
