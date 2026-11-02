import { cn } from '@tale/ui/cn';
import { Tooltip } from '@tale/ui/tooltip';
import { useSlidingIndicator } from '@tale/ui/use-sliding-indicator';
import { Link, useLocation } from '@tanstack/react-router';

import { isItemActive, type NavItem } from '@/app/hooks/use-nav-items';

const LINK_CLASS =
  'focus-visible:ring-ring inline-block rounded-md focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset';

interface RailListItemProps {
  item: NavItem;
  active: boolean;
}

/**
 * One tile of the rail: a 36x36 icon-only link. The label is the accessible
 * name; sighted readers get it as a tooltip on the right. The active fill is
 * one shared pill that glides between tiles (see `RailList`), so the tile only
 * switches its colour.
 */
function RailListItem({ item, active }: RailListItemProps) {
  const Icon = item.icon;
  return (
    <li className="relative">
      <Tooltip content={item.label} side="right">
        <Link
          to={item.to}
          data-indicator-key={item.to}
          aria-label={item.label}
          aria-current={active ? 'page' : undefined}
          className={LINK_CLASS}
        >
          <div
            data-active={active}
            className={cn(
              'relative flex size-9 items-center justify-center rounded-md transition-[color,background-color,transform] duration-150 active:scale-[0.94] motion-reduce:transition-none',
              active
                ? 'text-foreground'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            <Icon
              aria-hidden
              className={cn(
                'size-5 shrink-0 transition-[stroke-width] duration-150',
                active && '[stroke-width:2.25]',
              )}
            />
          </div>
        </Link>
      </Tooltip>
    </li>
  );
}

interface RailListProps {
  items: readonly NavItem[];
}

/**
 * A list of rail tiles; a rail click always opens the section's overview. It is
 * no landmark of its own: the rail names one navigation for the sections and
 * for Settings at its foot (as the platform's does), and a list inside it.
 * Mirrors `SidebarNav` and `SidebarNavItem` of the platform
 * (`app/components/layout/app-sidebar/sidebar-nav.tsx`).
 */
export function RailList({ items }: RailListProps) {
  const { pathname } = useLocation();
  const activeTo = items.find((item) => isItemActive(item, pathname))?.to;
  // One pill for the whole list: it glides from the tile you left to the tile
  // you chose, instead of one fill blinking out while another blinks in.
  const { containerRef, ...indicator } = useSlidingIndicator<HTMLUListElement>(
    activeTo ?? null,
    items.length,
  );

  return (
    <ul
      ref={containerRef}
      role="list"
      className="relative flex list-none flex-col gap-2"
    >
      <span
        aria-hidden
        style={indicator.style}
        className={cn(
          'bg-muted pointer-events-none absolute top-0 left-0 rounded-md',
          indicator.transitionClassName,
        )}
      />
      {items.map((item) => (
        <RailListItem key={item.to} item={item} active={item.to === activeTo} />
      ))}
    </ul>
  );
}
