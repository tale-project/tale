'use client';

import { type LucideIcon } from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';

import { cn } from '../../lib/cn';

export interface BottomTabBarItem {
  /** Stable identifier for the item — used as the React key. */
  key: string;
  /** Visible label rendered under the icon. */
  label: ReactNode;
  /** Lucide icon component. */
  icon: LucideIcon;
  /** `true` to mark the item as the active route. */
  active?: boolean;
  /** Optional badge (e.g. `3` or `'!'`) rendered as a dot on the icon. */
  badge?: ReactNode;
  /** Click handler — typically wired to `useNavigate()`. */
  onSelect: () => void;
  /**
   * Optional accent color (org branding) — applied as background + text color
   * on the active state. When absent, the active state uses the muted token.
   */
  accentColor?: string;
}

export interface BottomTabBarProps extends Omit<
  React.HTMLAttributes<HTMLElement>,
  'children'
> {
  items: BottomTabBarItem[];
  /** Accessible label for the navigation landmark. */
  ariaLabel: string;
}

/**
 * Fixed bottom tab bar primitive. Renders 2-5 items as a row of equally-sized
 * touch targets (44×44 min). Honors `env(safe-area-inset-bottom)` so the bar
 * sits above the iOS home indicator. Hidden on `md+` viewports — desktop uses
 * a sidebar.
 *
 * The bar has no router knowledge: callers pass `onSelect` per item and wire
 * navigation themselves (e.g. via `useNavigate()`).
 */
export const BottomTabBar = forwardRef<HTMLElement, BottomTabBarProps>(
  ({ items, ariaLabel, className, ...props }, ref) => (
    <nav
      ref={ref}
      aria-label={ariaLabel}
      className={cn(
        'bg-background/95 border-border fixed inset-x-0 bottom-0 z-50 flex border-t shadow-[0_-1px_2px_rgba(0,0,0,0.04)] backdrop-blur-md md:hidden',
        'pb-(--safe-bottom) pl-(--safe-left) pr-(--safe-right)',
        className,
      )}
      {...props}
    >
      {items.map((item) => (
        <BottomTabBarButton key={item.key} item={item} />
      ))}
    </nav>
  ),
);
BottomTabBar.displayName = 'BottomTabBar';

interface BottomTabBarButtonProps {
  item: BottomTabBarItem;
}

function BottomTabBarButton({ item }: BottomTabBarButtonProps) {
  const Icon = item.icon;
  const activeStyle =
    item.active && item.accentColor ? { color: item.accentColor } : undefined;
  const pillStyle =
    item.active && item.accentColor
      ? { backgroundColor: `${item.accentColor}1f` }
      : undefined;
  return (
    <button
      type="button"
      onClick={item.onSelect}
      aria-current={item.active ? 'page' : undefined}
      className={cn(
        'group relative flex min-h-12 min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-0.5 px-1 pt-2 pb-1.5 text-[11px] font-medium transition-colors',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none',
        item.active
          ? item.accentColor
            ? ''
            : 'text-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
      style={activeStyle}
    >
      <span
        className={cn(
          'relative inline-flex h-7 min-w-12 items-center justify-center rounded-full px-3 transition-colors',
          item.active && !item.accentColor && 'bg-muted',
        )}
        style={pillStyle}
      >
        <Icon className="size-5" aria-hidden="true" />
        {item.badge !== undefined && (
          <>
            <span
              aria-hidden="true"
              className="bg-destructive text-destructive-foreground absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold"
            >
              {item.badge}
            </span>
            <span className="sr-only">
              {' '}
              ({stringifyBadge(item.badge)} unread)
            </span>
          </>
        )}
      </span>
      <span className="line-clamp-2 max-w-full text-center leading-tight text-balance wrap-break-word">
        {item.label}
      </span>
    </button>
  );
}

function stringifyBadge(badge: ReactNode): string {
  if (badge === null || badge === undefined) return '';
  if (typeof badge === 'string') return badge;
  if (typeof badge === 'number') return String(badge);
  return '';
}
