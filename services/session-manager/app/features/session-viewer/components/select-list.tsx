import { cn } from '@tale/ui/cn';
import { Check } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import { useT } from '@/lib/i18n/client';
import type { SelectOptionInfo } from '@/lib/live-view';

import type { Placement, Size } from '../lib/fit-view';
import { placeList } from '../lib/list-placement';
import type { SelectMenuInfo, ViewInfo } from '../lib/live-state';
import { TOUCH_TARGET } from '../lib/touch';

/** How long typed letters count as one word to look up (milliseconds). */
const TYPEAHEAD_MS = 700;

interface SelectListProps {
  /** The `<select>` of the page that is open, and its options. */
  menu: SelectMenuInfo;
  view: ViewInfo;
  /** Where the picture of the page sits in its screen. */
  placement: Placement;
  screen: Size;
  /** Answers the list: the index of the option, or null when it was dismissed. */
  onPick: (token: number, index: number | null) => void;
  /** The list is closed: the keyboard goes back to the page. */
  returnFocus: () => void;
}

interface IndexedOption {
  option: SelectOptionInfo;
  index: number;
}

interface OptionGroup {
  label: string | null;
  items: IndexedOption[];
}

/** The options in runs of one group, as the page lists them. */
function groupOptions(options: readonly SelectOptionInfo[]): OptionGroup[] {
  const groups: OptionGroup[] = [];
  options.forEach((option, index) => {
    const last = groups.at(-1);
    if (last !== undefined && last.label === option.group) {
      last.items.push({ option, index });
    } else {
      groups.push({ label: option.group, items: [{ option, index }] });
    }
  });
  return groups;
}

/** Where the keyboard starts: the option the page has chosen, else the first one that can be. */
function firstActive(options: readonly SelectOptionInfo[]): number {
  const chosen = options.findIndex(
    (option) => option.selected && !option.disabled,
  );
  return chosen >= 0 ? chosen : options.findIndex((option) => !option.disabled);
}

/**
 * The list of a `<select>` of the page, which the browser draws outside the
 * page and so cannot show in a picture of it. It opens where the `<select>`
 * is in the picture, as a listbox the keyboard can use: the arrow keys, Home
 * and End move, typing a letter jumps to an option, Enter chooses, Escape or a
 * click elsewhere closes it without a choice.
 *
 * One list is for one `<select>`: give it the token as its key.
 */
export function SelectList({
  menu,
  view,
  placement,
  screen,
  onPick,
  returnFocus,
}: SelectListProps) {
  const { t } = useT('viewer');
  const listRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef(new Map<number, HTMLButtonElement>());
  const typed = useRef<{ text: string; timer: number | undefined }>({
    text: '',
    timer: undefined,
  });
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [active, setActive] = useState(() => firstActive(menu.options));

  const enabled = useMemo(
    () =>
      menu.options.flatMap((option, index) => (option.disabled ? [] : [index])),
    [menu.options],
  );
  const groups = useMemo(() => groupOptions(menu.options), [menu.options]);

  const dismiss = () => {
    onPick(menu.token, null);
    returnFocus();
  };
  // The listener below outlives a render: it calls what is current.
  const dismissRef = useRef(dismiss);
  useLayoutEffect(() => {
    dismissRef.current = dismiss;
  });

  // The list is placed by its own size, which is only known once it is drawn
  // (it does not change: one list is for one `<select>`).
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    setSize({ width: list.offsetWidth, height: list.offsetHeight });
  }, []);

  // The option that is active takes the keyboard, and comes into view.
  useEffect(() => {
    const option = optionRefs.current.get(active);
    option?.focus({ preventScroll: true });
    option?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // A press anywhere else dismisses the list, like a click away from a native one.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const list = listRef.current;
      if (
        list !== null &&
        event.target instanceof Node &&
        list.contains(event.target)
      ) {
        return;
      }
      dismissRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  useEffect(() => {
    const state = typed.current;
    return () => window.clearTimeout(state.timer);
  }, []);

  const move = (to: number | undefined) => {
    if (to !== undefined) setActive(to);
  };

  const step = (by: 1 | -1) => {
    const at = enabled.indexOf(active);
    move(enabled.at((at + by + enabled.length) % enabled.length));
  };

  // Typing letters jumps to the option that starts with them; the same letter
  // again goes on to the next option with it.
  const jumpTo = (letter: string) => {
    const state = typed.current;
    window.clearTimeout(state.timer);
    state.text += letter.toLowerCase();
    state.timer = window.setTimeout(() => {
      state.text = '';
    }, TYPEAHEAD_MS);
    const repeated = state.text
      .split('')
      .every((char) => char === state.text[0]);
    const prefix = repeated ? state.text[0] : state.text;
    const at = enabled.indexOf(active);
    const from = repeated ? at + 1 : at;
    const ordered = [...enabled.slice(from), ...enabled.slice(0, from)];
    move(
      ordered.find((index) =>
        menu.options[index]?.label.toLowerCase().startsWith(prefix),
      ),
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'Escape':
        // Not the page's Escape, and not that of anything around the list.
        event.preventDefault();
        event.stopPropagation();
        dismiss();
        return;
      case 'Tab':
        event.preventDefault();
        dismiss();
        return;
      case 'ArrowDown':
        event.preventDefault();
        step(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        step(-1);
        return;
      case 'Home':
        event.preventDefault();
        move(enabled[0]);
        return;
      case 'End':
        event.preventDefault();
        move(enabled.at(-1));
        return;
      default: {
        // A space chooses the option that has the focus, like Enter.
        const letter =
          event.key.length === 1 &&
          event.key !== ' ' &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey;
        if (letter) {
          event.preventDefault();
          jumpTo(event.key);
        }
      }
    }
  };

  const placed = placeList({
    anchor: menu,
    view,
    picture: placement,
    screen,
    list: size,
  });

  const optionButton = ({ option, index }: IndexedOption) => (
    <button
      key={index}
      ref={(node) => {
        if (node === null) optionRefs.current.delete(index);
        else optionRefs.current.set(index, node);
      }}
      type="button"
      role="option"
      aria-selected={option.selected}
      disabled={option.disabled}
      tabIndex={index === active ? 0 : -1}
      onClick={() => {
        onPick(menu.token, index);
        returnFocus();
      }}
      // The rows of `Select` (`packages/ui/src/components/forms/select.tsx`): the
      // active one has the keyboard, so `focus:`, not `focus-visible:` (a list
      // opened with the mouse has no ring to show).
      className={cn(
        'hover:bg-accent focus:bg-accent focus:text-accent-foreground relative flex w-full items-center rounded-sm py-1.5 pr-8 pl-2 text-left text-sm outline-none',
        'disabled:pointer-events-none disabled:opacity-50',
        TOUCH_TARGET,
        option.selected && 'font-medium',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{option.label || ' '}</span>
      {option.selected && (
        <Check
          className="absolute right-2 size-4 shrink-0"
          aria-hidden="true"
        />
      )}
    </button>
  );

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={t('select.label')}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{
        left: placed.left,
        top: placed.top,
        minWidth: placed.minWidth,
        maxHeight: placed.maxHeight,
      }}
      // The surface of the list of `Select`: a popover over the page is `bg-popover`,
      // and on the dark theme `bg-muted`, the one that stands out from what is under it.
      className="bg-popover text-popover-foreground dark:bg-muted absolute z-20 max-w-[calc(100%-1rem)] overflow-y-auto rounded-md border p-1 shadow-md"
    >
      {groups.map((group, position) =>
        group.label === null ? (
          group.items.map(optionButton)
        ) : (
          <div
            key={`${position}:${group.label}`}
            role="group"
            aria-label={group.label}
          >
            <div
              aria-hidden="true"
              className="text-muted-foreground px-2.5 pt-2 pb-1 text-xs font-medium"
            >
              {group.label}
            </div>
            {group.items.map(optionButton)}
          </div>
        ),
      )}
    </div>
  );
}
