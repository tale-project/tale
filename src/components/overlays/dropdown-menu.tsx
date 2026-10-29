'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Check, Search } from 'lucide-react';
import {
  type ComponentType,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useId,
  useRef,
  useState,
} from 'react';

import { cn } from '../../lib/cn';
import { respectEscapeClaims } from './claims-escape';
import { TooltipContent } from './tooltip';

export interface DropdownMenuActionItem {
  type: 'item';
  label: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  onClick?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  className?: string;
  href?: string;
  external?: boolean;
  /** Keep the menu open after click. Use for items that swap the menu's content in place. */
  keepOpen?: boolean;
  /**
   * Muted text pinned to the right of the row (e.g. "Requires Tavily"). When
   * combined with `selected`, the trailing text sits to the *left* of the
   * checkmark so the check always reads as the right-most element.
   */
  trailing?: ReactNode;
  /**
   * Render a right-aligned check on the row to mark it as the active choice.
   * Use this instead of baking a "✓" into the label so the mark is pinned to
   * the far right of the row regardless of label length or any `trailing`.
   */
  selected?: boolean;
  /** Extra words the menu's search matches, beside a string label. */
  keywords?: string;
}

type PointerDownOutsideEvent = Parameters<
  NonNullable<
    DropdownMenuPrimitive.DropdownMenuContentProps['onPointerDownOutside']
  >
>[0];

export interface DropdownMenuLabelItem {
  type: 'label';
  content: ReactNode;
  className?: string;
}

export interface DropdownMenuSubItem {
  type: 'sub';
  label: string;
  icon?: ComponentType<{ className?: string }>;
  items: DropdownMenuItemsSource;
  className?: string;
  /** Optional trailing text shown before the chevron (e.g. current selection). */
  trailing?: ReactNode;
  /**
   * Extra classes applied to the sub-menu content panel. Use when the
   * default `min-w-[8rem]` is too narrow for the embedded content (e.g.
   * an org switcher row with name + slug + role).
   */
  contentClassName?: string;
}

export interface DropdownMenuRadioGroupItem {
  type: 'radio-group';
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: ReactNode }>;
}

export interface DropdownMenuCustomItem {
  type: 'custom';
  content: ReactNode;
}

/**
 * Boolean toggle rendered inside the menu. Renders as
 * `DropdownMenuPrimitive.CheckboxItem` so Radix's roving-tabindex
 * picks it up (arrow-key navigation works) and screen readers announce
 * `role="menuitemcheckbox"` + `aria-checked`. `onSelect` is suppressed so
 * activating the toggle keeps the menu open. Round-1 / round-2 HIGH #13.
 */
export interface DropdownMenuCheckboxItem {
  type: 'checkbox';
  label: ReactNode;
  description?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  /**
   * A choice that is always on and cannot be switched off — shown checked
   * at full strength (not greyed like `disabled`) and announced as checked
   * and unavailable, so the menu can list what an agent always has beside
   * what it can be given.
   */
  locked?: boolean;
  className?: string;
  /** Extra words the menu's search matches, beside a string label. */
  keywords?: string;
}

export type DropdownMenuItem =
  | DropdownMenuActionItem
  | DropdownMenuLabelItem
  | DropdownMenuSubItem
  | DropdownMenuRadioGroupItem
  | DropdownMenuCustomItem
  | DropdownMenuCheckboxItem;

export type DropdownMenuGroup = DropdownMenuItem[];

export type DropdownMenuItemsSource =
  | DropdownMenuGroup[]
  | (() => DropdownMenuGroup[]);

/**
 * A search field at the top of the open menu that narrows its rows as the
 * person types. It matches a row's string label, string description and
 * `keywords`; a group's label stays while any row under it matches. The
 * strings come from the caller, so the field speaks the host's language.
 */
export interface DropdownMenuSearch {
  /** The field's accessible name. */
  label: string;
  placeholder?: string;
  /** What the menu says when no row matches. */
  emptyText: ReactNode;
}

interface DropdownMenuProps {
  trigger: ReactNode;
  /**
   * The menu's groups, or a function that builds them. Either way they are
   * rendered only while the menu shows; a function is also only CALLED then,
   * so a closed menu in every row of a long list builds nothing — pass one
   * when the groups are costly to assemble (a submenu listing every project).
   */
  items: DropdownMenuItemsSource;
  align?: 'start' | 'center' | 'end';
  /** Side the menu opens on. @default 'bottom' (Radix default) */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Gap between the trigger and the menu. @default 4 */
  sideOffset?: number;
  /**
   * Distance the menu keeps from the viewport edges before Radix shifts it.
   * The default suits floating menus; an edge-anchored panel (the rail's
   * account menu) passes the rail's own inset so alignment with its trigger
   * survives near the viewport edge.
   */
  collisionPadding?: number;
  contentClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Optional hover/focus tooltip for the trigger. When set, the trigger is
   * composed with a Radix tooltip (both triggers share the same DOM node via
   * `asChild`), so the menu still opens on click while the tooltip explains it
   * on hover. Handy for icon-only triggers in dense toolbars.
   */
  tooltip?: ReactNode;
  /** Side the tooltip opens on. @default 'top' */
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  /** Disables the trigger at the Radix level so the menu can't open — a
   *  disabled child <button> alone doesn't stop keyboard/pointer activation. */
  disabled?: boolean;
  /**
   * Registers the menu as a modal layer. Use this when the trigger lives in
   * a modal Dialog so that the dialog's scroll lock does not swallow wheel
   * events over the portaled menu content.
   * @default false
   */
  modal?: boolean;
  /** Adds a search field above the rows (see `DropdownMenuSearch`). */
  search?: DropdownMenuSearch;
}

function RadioIndicator() {
  return (
    <DropdownMenuPrimitive.ItemIndicator className="absolute right-2 flex size-3.5 items-center justify-center">
      <Check className="size-3.5" />
    </DropdownMenuPrimitive.ItemIndicator>
  );
}

function renderItem(item: DropdownMenuItem, key: number) {
  switch (item.type) {
    case 'label':
      return (
        <DropdownMenuPrimitive.Label
          key={key}
          className={cn('px-2 py-1.5 text-sm font-semibold', item.className)}
        >
          {item.content}
        </DropdownMenuPrimitive.Label>
      );

    case 'custom':
      return <Fragment key={key}>{item.content}</Fragment>;

    case 'checkbox': {
      const CheckboxIcon = item.icon;
      return (
        <DropdownMenuPrimitive.CheckboxItem
          key={key}
          checked={item.locked === true ? true : item.checked}
          onCheckedChange={item.onCheckedChange}
          disabled={item.disabled === true || item.locked === true}
          // Prevent default suppresses the close-on-select behaviour so
          // toggling stays inside the menu — matches the OS conventions
          // for grouped settings dropdowns.
          onSelect={(e) => e.preventDefault()}
          className={cn(
            'focus:bg-accent focus:text-accent-foreground relative flex min-h-11 cursor-default items-center gap-2 rounded-md px-2 py-2 text-base outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
            item.locked === true && 'data-disabled:opacity-100',
            item.className,
          )}
        >
          {CheckboxIcon ? <CheckboxIcon /> : null}
          <span className="flex flex-1 flex-col">
            <span className="text-sm">{item.label}</span>
            {item.description != null && (
              <span className="text-muted-foreground text-xs">
                {item.description}
              </span>
            )}
          </span>
          <DropdownMenuPrimitive.ItemIndicator
            forceMount
            className="ml-auto inline-flex"
          >
            <span
              aria-hidden
              className={cn(
                'inline-block h-4 w-7 rounded-full transition-colors',
                item.locked === true
                  ? 'bg-primary/60'
                  : item.checked
                    ? 'bg-primary'
                    : 'bg-muted',
              )}
            >
              <span
                className={cn(
                  'block h-3 w-3 translate-y-0.5 rounded-full bg-white shadow transition-transform',
                  item.checked || item.locked === true
                    ? 'translate-x-3.5'
                    : 'translate-x-0.5',
                )}
              />
            </span>
          </DropdownMenuPrimitive.ItemIndicator>
        </DropdownMenuPrimitive.CheckboxItem>
      );
    }

    case 'sub': {
      const SubIcon = item.icon;
      return (
        <DropdownMenuPrimitive.Sub key={key}>
          <DropdownMenuPrimitive.SubTrigger
            className={cn(
              'focus:bg-accent data-[state=open]:bg-accent flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
              item.className,
            )}
          >
            {SubIcon && <SubIcon />}
            <span>{item.label}</span>
            {item.trailing != null && (
              <span className="text-muted-foreground ml-auto max-w-[10rem] truncate text-xs">
                {item.trailing}
              </span>
            )}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn(
                'size-4 shrink-0',
                item.trailing == null && 'ml-auto',
              )}
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </DropdownMenuPrimitive.SubTrigger>
          <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.SubContent
              // An 8px visual gap to the parent panel — the same distance the
              // rail menus keep to the nav edge. Radix measures from the
              // trigger item, which sits inside the panel's 4px padding and
              // 1px border, so those are added back here. Portaled so the
              // parent panel's overflow/transform cannot clip this gutter.
              sideOffset={13}
              collisionPadding={16}
              className={cn(
                'bg-card text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] origin-[var(--radix-dropdown-menu-content-transform-origin)] overflow-hidden rounded-lg border p-1 shadow-lg duration-[var(--duration-short)] motion-reduce:animate-none',
                item.contentClassName,
              )}
            >
              <MenuGroups items={item.items} />
            </DropdownMenuPrimitive.SubContent>
          </DropdownMenuPrimitive.Portal>
        </DropdownMenuPrimitive.Sub>
      );
    }

    case 'radio-group':
      return (
        <DropdownMenuPrimitive.RadioGroup
          key={key}
          value={item.value}
          onValueChange={item.onValueChange}
        >
          {item.options.map((option) => (
            <DropdownMenuPrimitive.RadioItem
              key={option.value}
              value={option.value}
              className="focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
            >
              <RadioIndicator />
              {option.label}
            </DropdownMenuPrimitive.RadioItem>
          ))}
        </DropdownMenuPrimitive.RadioGroup>
      );

    case 'item': {
      const Icon = item.icon;
      const hasTrailing = item.trailing != null || item.selected === true;
      const menuItem = (
        <DropdownMenuPrimitive.Item
          className={cn(
            'focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
            item.destructive && 'text-destructive focus:text-destructive',
            item.className,
          )}
          // `keepOpen` items swap the panel's contents in place, so run the
          // handler on `onSelect` — which fires for BOTH pointer and keyboard
          // activation — and preventDefault to keep the menu open. Routing
          // through `onClick` (pointer-only) would make the item unreachable by
          // keyboard; wiring both would double-fire on click.
          onSelect={(e) => {
            if (item.keepOpen) {
              e.preventDefault();
            }
            item.onClick?.();
          }}
          disabled={item.disabled}
        >
          {Icon && <Icon />}
          {typeof item.label === 'string' ? (
            // When the row carries a trailing slot, let the label flex and
            // truncate so the trailing text / checkmark stay pinned right.
            <span className={cn(hasTrailing && 'min-w-0 flex-1 truncate')}>
              {item.label}
            </span>
          ) : (
            item.label
          )}
          {item.trailing != null && (
            <span className="text-muted-foreground ml-auto shrink-0 text-xs">
              {item.trailing}
            </span>
          )}
          {item.selected === true && (
            <Check
              aria-hidden
              className={cn(
                'text-muted-foreground size-4 shrink-0',
                // Pin the check to the far right. With no `trailing` text it
                // claims the free space itself; with trailing text the
                // trailing span owns `ml-auto` and the check trails it.
                item.trailing == null && 'ml-auto',
              )}
            />
          )}
        </DropdownMenuPrimitive.Item>
      );

      if (item.href) {
        return (
          <a
            key={key}
            href={item.href}
            target={item.external ? '_blank' : undefined}
            rel={item.external ? 'noopener noreferrer' : undefined}
          >
            {menuItem}
          </a>
        );
      }

      return <Fragment key={key}>{menuItem}</Fragment>;
    }
    default:
      return undefined;
  }
}

/** The words a row offers the menu's search: its string label and
 * description, plus `keywords`. A row with no words never matches. */
function searchableText(item: DropdownMenuItem): string {
  switch (item.type) {
    case 'item':
      return [
        typeof item.label === 'string' ? item.label : '',
        item.keywords ?? '',
      ].join(' ');
    case 'checkbox':
      return [
        typeof item.label === 'string' ? item.label : '',
        typeof item.description === 'string' ? item.description : '',
        item.keywords ?? '',
      ].join(' ');
    case 'sub':
      return item.label;
    default:
      return '';
  }
}

/** The groups narrowed to the rows matching every word of `query`; a
 * group's labels stay while a row under them matches, an emptied group
 * goes. An empty query keeps everything. */
export function filterMenuGroups(
  groups: DropdownMenuGroup[],
  query: string,
): DropdownMenuGroup[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return groups;
  const matches = (item: DropdownMenuItem) => {
    const text = searchableText(item).toLocaleLowerCase();
    return words.every((word) => text.includes(word));
  };
  const narrowed: DropdownMenuGroup[] = [];
  for (const group of groups) {
    // Labels head the rows after them until the next label: keep a label
    // only when one of its rows survives.
    const kept: DropdownMenuItem[] = [];
    let pendingLabels: DropdownMenuItem[] = [];
    for (const item of group) {
      if (item.type === 'label') {
        pendingLabels.push(item);
        continue;
      }
      if (!matches(item)) continue;
      kept.push(...pendingLabels, item);
      pendingLabels = [];
    }
    if (kept.length > 0) narrowed.push(kept);
  }
  return narrowed;
}

/** The open menu's rows. A component of its own, so its render — and a
 * lazy `items` function — runs only while the Content it sits in is
 * mounted: Radix mounts it while the menu shows, exit animation included. */
function MenuGroups({
  items,
  query = '',
  emptyText,
}: {
  items: DropdownMenuItemsSource;
  query?: string;
  emptyText?: ReactNode;
}) {
  const groups = filterMenuGroups(
    typeof items === 'function' ? items() : items,
    query,
  );
  if (groups.length === 0 && emptyText !== undefined) {
    return (
      <p role="status" className="text-muted-foreground px-2 py-3 text-sm">
        {emptyText}
      </p>
    );
  }
  return renderGroups(groups);
}

/** The search field over an open menu's rows. Its keys stay its own: the
 * menu's typeahead would otherwise jump to a row on every letter typed. Arrow
 * Down moves into the rows; Escape still closes the menu. */
function MenuSearchField({
  search,
  value,
  onChange,
  inputRef,
}: {
  search: DropdownMenuSearch;
  value: string;
  onChange: (next: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const id = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') return;
    event.stopPropagation();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const content = event.currentTarget.closest('[role="menu"]');
      const first = content?.querySelector<HTMLElement>(
        '[role^="menuitem"]:not([data-disabled])',
      );
      first?.focus();
    }
  };
  return (
    <div className="bg-card sticky -top-1 z-10 -mx-1 -mt-1 mb-1 border-b px-1 pt-1 pb-1">
      <label htmlFor={id} className="sr-only">
        {search.label}
      </label>
      <div className="flex items-center gap-2 px-2">
        <Search aria-hidden className="text-muted-foreground size-4 shrink-0" />
        <input
          ref={inputRef}
          id={id}
          type="search"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={search.placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          className="placeholder:text-muted-foreground h-9 w-full min-w-0 bg-transparent text-sm outline-none"
        />
      </div>
    </div>
  );
}

function renderGroups(groups: DropdownMenuGroup[]) {
  return groups.map((group, groupIndex) => (
    <Fragment key={groupIndex}>
      {groupIndex > 0 && (
        <DropdownMenuPrimitive.Separator className="bg-border -mx-1 my-1 h-px" />
      )}
      {group.map((item, itemIndex) => renderItem(item, itemIndex))}
    </Fragment>
  ));
}

export function DropdownMenu({
  trigger,
  items,
  align,
  side,
  sideOffset,
  collisionPadding,
  contentClassName,
  open,
  onOpenChange,
  tooltip,
  tooltipSide = 'top',
  disabled,
  modal = false,
  search,
}: DropdownMenuProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');

  // A menu that is animating out is still a dismissable layer, and its own
  // trigger counts as "outside" of it. Left alone, a pointer-down on the
  // trigger inside that window toggles the menu open and the old layer then
  // dismisses it again, so the click is lost: pick a language in the account
  // menu, click the avatar right away, nothing opens. The trigger owns its
  // pointer-downs; the layer must not act on them.
  const keepTriggerPointerDown = useCallback(
    (event: PointerDownOutsideEvent) => {
      const { button, ctrlKey } = event.detail.originalEvent;
      if (button !== 0 || ctrlKey) return;
      const target = event.target;
      if (target instanceof Node && triggerRef.current?.contains(target)) {
        event.preventDefault();
      }
    },
    [],
  );

  const triggerEl = (
    <DropdownMenuPrimitive.Trigger
      ref={triggerRef}
      asChild
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
    >
      {trigger}
    </DropdownMenuPrimitive.Trigger>
  );

  return (
    <DropdownMenuPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        // Every opening starts from the whole list.
        if (!next) setQuery('');
        onOpenChange?.(next);
      }}
      // A menu can hand off to a modal while its exit animation is mounted.
      // Keeping both layers modal leaves Radix's outside-pointer lock behind
      // when the second overlay closes. The dialog owns modality; menus keep
      // their roving focus, Escape and outside-dismiss behavior without it.
      modal={modal}
    >
      {tooltip ? (
        // Radix's documented composition for "tooltip on a menu trigger":
        // both `asChild` triggers collapse onto the same button so the menu
        // still opens on click while the tooltip shows on hover/focus.
        <TooltipPrimitive.Root>
          <TooltipPrimitive.Trigger asChild>
            {triggerEl}
          </TooltipPrimitive.Trigger>
          <TooltipPrimitive.Portal>
            {/* collisionPadding keeps the tooltip off the viewport edge so it
                can't visually overlap adjacent controls in dense toolbars. */}
            <TooltipContent side={tooltipSide} collisionPadding={8}>
              {tooltip}
            </TooltipContent>
          </TooltipPrimitive.Portal>
        </TooltipPrimitive.Root>
      ) : (
        triggerEl
      )}
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          side={side}
          sideOffset={sideOffset ?? 4}
          align={align}
          collisionPadding={collisionPadding ?? 16}
          onClick={(e) => e.stopPropagation()}
          onPointerDownOutside={keepTriggerPointerDown}
          onEscapeKeyDown={respectEscapeClaims()}
          {...(search !== undefined
            ? {
                // A searchable menu opens with the caret in its field.
                onOpenAutoFocus: (event: Event) => {
                  event.preventDefault();
                  searchRef.current?.focus();
                },
              }
            : {})}
          style={{
            maxHeight:
              'min(80vh, var(--radix-dropdown-menu-content-available-height, 80vh))',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
          }}
          className={cn(
            'bg-card text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-[min(80vh,var(--radix-dropdown-menu-content-available-height,80vh))] max-w-(--radix-dropdown-menu-content-available-width) min-w-[max(10rem,var(--radix-dropdown-menu-trigger-width))] origin-[var(--radix-dropdown-menu-content-transform-origin)] overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg border p-1 shadow-md duration-[var(--duration-short)] motion-reduce:animate-none',
            contentClassName,
          )}
        >
          {search !== undefined && (
            <MenuSearchField
              search={search}
              value={query}
              onChange={setQuery}
              inputRef={searchRef}
            />
          )}
          <MenuGroups
            items={items}
            query={search !== undefined ? query : ''}
            {...(search !== undefined ? { emptyText: search.emptyText } : {})}
          />
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
