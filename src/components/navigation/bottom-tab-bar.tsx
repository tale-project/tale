'use client';

import { type LucideIcon } from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';

import { useSlidingIndicator } from '../../hooks/use-sliding-indicator';
import { cn } from '../../lib/cn';
import { COUNT_BADGE_CLASS, CountBadge } from '../feedback/count-badge';
import { SkeletonBox, SkeletonCircle } from '../feedback/skeleton';
import { Skeletonize } from '../feedback/skeleton-context';
import { Card } from '../layout/card';

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
  /**
   * What the badge MEANS, already translated ("3 unread conversations").
   * Read out after the tab label; the chip itself is decorative. Without it
   * the bar falls back to an English "(N unread)", which is right for no
   * locale but English — pass this whenever the app ships more than one.
   */
  badgeLabel?: string;
  /** Click handler — typically wired to `useNavigate()`. */
  onSelect: () => void;
  /**
   * Optional accent color (org branding) — applied as background + text color
   * on the active state. When absent, the active state uses the muted token.
   */
  accentColor?: string;
  /**
   * Mark a single item as the bar's primary action. Renders with a permanent
   * pill background (even when inactive) and a slightly larger icon, so the
   * center slot reads as "the main thing" without breaking tab-bar layout.
   */
  featured?: boolean;
}

export interface BottomTabBarProps extends Omit<
  React.HTMLAttributes<HTMLElement>,
  'children'
> {
  /** Icon-only, narrower presentation; touch targets remain at least 44px. */
  compact?: boolean;
  items: BottomTabBarItem[];
  /** Accessible label for the navigation landmark. */
  ariaLabel: string;
}

// One capsule geometry for the live bar and the pre-hydration placeholder.
const BAR_FRAME_CLASS = 'mobile-tab-bar md:hidden';
const TAB_CLASS =
  'relative z-10 flex min-h-11 min-w-11 flex-auto flex-col items-center justify-center gap-0.5 rounded-full px-0.5';
const PILL_CLASS =
  'relative inline-flex h-7 min-w-8 items-center justify-center rounded-full';
const LABEL_CLASS =
  'max-w-full truncate text-center text-[11px] leading-tight tracking-tight';

/**
 * Floating mobile navigation. Place in a positioned viewport-height shell;
 * content owns end clearance through the shared mobile-navigation variables.
 * Labels determine each tab's minimum useful width before surplus is shared.
 * Hidden on md+; routing and permissions remain the caller's responsibility.
 */
export const BottomTabBar = forwardRef<HTMLElement, BottomTabBarProps>(
  ({ items, ariaLabel, compact = false, className, ...props }, ref) => {
    const active = items.find((item) => item.active);
    const { containerRef, ...indicator } = useSlidingIndicator<HTMLDivElement>(
      active?.key ?? null,
      items,
    );
    return (
      <Card asChild padding="none" className={cn(BAR_FRAME_CLASS, className)}>
        <nav
          data-compact={compact || undefined}
          ref={ref}
          aria-label={ariaLabel}
          {...props}
        >
          <div ref={containerRef} className="relative flex h-full w-full">
            <span
              aria-hidden
              className={cn(
                'bg-muted pointer-events-none absolute top-0 left-0 rounded-full',
                indicator.transitionClassName,
              )}
              style={{
                ...indicator.style,
                ...(active?.accentColor
                  ? { backgroundColor: `${active.accentColor}1f` }
                  : {}),
              }}
            />
            {items.map((item) => (
              <BottomTabBarButton
                key={item.key}
                item={item}
                compact={compact}
              />
            ))}
          </div>
        </nav>
      </Card>
    );
  },
);
BottomTabBar.displayName = 'BottomTabBar';

export interface BottomTabBarPlaceholderProps {
  /** How many masked tabs to draw — match the live bar's usual item count. */
  tabs: number;
  /** Extra classes, e.g. the bottom clearance the live bar adds for a toolbar. */
  className?: string;
}

/**
 * Masked stand-in for `BottomTabBar` while the shell that owns the real bar
 * is still loading. Built from the bar's own tab geometry, so it is exactly as
 * tall as the live bar and the content above it does not move when the bar
 * replaces it. Renders no text (each label line is sized by a zero-width
 * glyph), so a server-rendered boot shell painting before its stylesheet
 * shows nothing stray.
 */
export function BottomTabBarPlaceholder({
  tabs,
  className,
}: BottomTabBarPlaceholderProps) {
  return (
    <Card
      aria-hidden="true"
      padding="none"
      className={cn(BAR_FRAME_CLASS, className)}
    >
      <Skeletonize loading className="flex h-full w-full">
        {Array.from({ length: tabs }, (_, index) => (
          // eslint-disable-next-line react/no-array-index-key -- a fixed row of identical masks
          <div key={index} className={TAB_CLASS}>
            <SkeletonCircle asChild>
              <span className={PILL_CLASS} />
            </SkeletonCircle>
            <SkeletonBox asChild>
              <span className={cn(LABEL_CLASS, 'mx-auto w-10')}>
                {'\u200B'}
              </span>
            </SkeletonBox>
          </div>
        ))}
      </Skeletonize>
    </Card>
  );
}

interface BottomTabBarButtonProps {
  item: BottomTabBarItem;
  compact: boolean;
}

function BottomTabBarButton({ item, compact }: BottomTabBarButtonProps) {
  const Icon = item.icon;
  const showPill = item.featured && !item.active;
  const activeStyle =
    item.active && item.accentColor ? { color: item.accentColor } : undefined;
  const pillStyle =
    showPill && item.accentColor
      ? { backgroundColor: `${item.accentColor}1f` }
      : undefined;
  return (
    <button
      type="button"
      data-indicator-key={item.key}
      onClick={item.onSelect}
      aria-current={item.active ? 'page' : undefined}
      className={cn(
        'group touch-manipulation text-[11px] font-medium transition-colors select-none [-webkit-tap-highlight-color:transparent]',
        TAB_CLASS,
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
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
          PILL_CLASS,
          'transition-colors',
          showPill && !item.accentColor && 'bg-muted',
        )}
        style={pillStyle}
      >
        <Icon
          className={cn('size-5', item.featured && 'size-6')}
          aria-hidden="true"
        />
        {item.badge !== undefined && (
          <>
            {typeof item.badge === 'number' ? (
              <CountBadge
                count={item.badge}
                className="absolute -top-0.5 -right-0.5"
              />
            ) : (
              <span
                aria-hidden="true"
                className={cn(
                  COUNT_BADGE_CLASS,
                  'absolute -top-0.5 -right-0.5',
                )}
              >
                {item.badge}
              </span>
            )}
            <span className="sr-only">
              {' '}
              {item.badgeLabel ?? `(${stringifyBadge(item.badge)} unread)`}
            </span>
          </>
        )}
      </span>
      <span className={compact ? 'sr-only' : LABEL_CLASS}>{item.label}</span>
    </button>
  );
}

function stringifyBadge(badge: ReactNode): string {
  if (badge === null || badge === undefined) return '';
  if (typeof badge === 'string') return badge;
  if (typeof badge === 'number') return String(badge);
  return '';
}
