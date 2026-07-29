import { Slot, Slottable } from '@radix-ui/react-slot';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Link } from '@tanstack/react-router';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2, type LucideIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '../../lib/cn';
import { SkeletonBox } from '../feedback/skeleton';
import { hasDisabledReason } from '../overlays/disabled-reason';
import { TooltipContent } from '../overlays/tooltip';

export const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-150 active:scale-[0.97] active:duration-75 motion-reduce:active:scale-100 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 disabled:hover:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:active:scale-100 aria-disabled:hover:opacity-50 leading-none ring-offset-background cursor-pointer',
  {
    variants: {
      // One height fits all (`h-9`), with a single smaller variant (`h-8`) for
      // dense bars/toolbars. Icon-only buttons are the same two heights, square.
      // There is deliberately no `lg` — page CTAs use the default height too.
      size: {
        default: 'h-9 px-4 grow-0',
        sm: 'h-8 rounded-md px-3 text-xs grow-0',
        icon: 'size-9',
        'icon-sm': 'size-8 rounded-md',
      },
      variant: {
        primary:
          'bg-accent-base text-accent-fg shadow-[0_1px_1.75px_rgba(3,7,18,0.4),0_0_0_1px_rgba(3,7,18,1)] hover:opacity-95 ring-1 ring-inset ring-white/20 [background-image:linear-gradient(to_bottom,rgba(255,255,255,0.16),rgba(255,255,255,0))]',
        destructive:
          'bg-red-600 text-destructive-foreground -outline-offset-1 outline-red-600 shadow-sm hover:bg-red-700',
        // Solid amber "caution" fill — the yellow counterpart to `destructive`'s
        // red. Dark text (amber-950) keeps AA contrast on the light-yellow fill
        // at rest AND on the darker hover, where white would fail.
        warning:
          'bg-amber-400 text-amber-950 -outline-offset-1 outline-amber-500 shadow-sm hover:bg-amber-500',
        success:
          'bg-success text-success-foreground -outline-offset-1 outline-success shadow-sm hover:bg-success/90',
        secondary:
          'bg-bg-base text-fg-base ring-1 ring-border-strong ring-inset shadow-sm hover:bg-bg-elevated',
        ghost: 'text-fg-base hover:bg-bg-elevated',
        // `h-auto` resets the size axis's fixed height so a link button stays
        // inline-sized (it's text, not a control box).
        link: 'text-fg-base h-auto px-0 py-1 relative after:content-[""] after:block after:w-full after:h-[1px] after:transition-all after:duration-300 after:ease-in-out after:absolute after:bottom-0 after:left-0 hover:after:bg-fg-base',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
);

interface ButtonOwnProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    Omit<VariantProps<typeof buttonVariants>, 'size'> {
  asChild?: boolean;
  isLoading?: boolean;
  /** Icon to display before the button text */
  icon?: LucideIcon;
  /** Additional className for the icon */
  iconClassName?: string;
  /** Make button full width */
  fullWidth?: boolean;
  /**
   * Collapse the text label to an icon-only button below the `sm` breakpoint.
   * The label stays in the accessibility tree (visually hidden), so the button
   * keeps its accessible name on mobile, then becomes visible from `sm` up.
   * Pair with an `icon` so there's something to show. Use in crowded toolbars
   * and action rows where labels would otherwise overlap on mobile.
   */
  collapseLabel?: boolean;
  /**
   * One-stop label for icon buttons: a plain-string `title` populates BOTH the
   * `aria-label` (accessibility) AND a hover/focus tooltip, so callers set a
   * single prop instead of repeating themselves. The native `title` attribute
   * is suppressed so there's no duplicate browser tooltip. An explicit
   * `aria-label` or `tooltip` overrides the respective half.
   */
  title?: string;
  /**
   * Rich tooltip content (overrides `title` for the visible tooltip only).
   * Use when the tooltip needs more than the plain accessible name — e.g. a
   * keyboard-shortcut badge. Rendered with the shared Tooltip primitive, and
   * NEVER when `asChild` is set (the button is then a Radix `Slot`, usually
   * another overlay's trigger, and wrapping a Slot in a tooltip trigger breaks
   * that composition).
   */
  tooltip?: React.ReactNode;
  /** Side the tooltip opens on (default `top`). */
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  /**
   * Controls the tooltip's open state. Radix force-closes a tooltip the moment
   * its trigger is clicked — a toggle button whose tip announces the *new*
   * state needs to hold it open right after the click, so such a caller owns
   * the state and decides when a close request is honoured. Leave undefined
   * for the normal hover/focus-driven tooltip. The tooltip must stay wired
   * here (not around the Button) because the trigger has to wrap the real
   * button inside the `SkeletonBox`.
   */
  tooltipOpen?: boolean;
  /** Radix open/close requests when `tooltipOpen` is controlled. */
  onTooltipOpenChange?: (open: boolean) => void;
  /**
   * Explains *why* the button is disabled, surfaced in a tooltip on hover AND
   * focus and to screen readers (#1949). Only takes effect while the button is
   * `disabled`; ignored otherwise, so callers can pass it unconditionally.
   *
   * A natively-`disabled` button emits no pointer events and leaves the tab
   * order, so neither a hover nor a focus tooltip could ever reach it. When a
   * disabled button carries a `disabledReason` we therefore keep it focusable,
   * swap the native `disabled` attribute for `aria-disabled` (still rendered
   * visually disabled and inert to clicks/Enter/Space), and let the shared
   * Tooltip wire up `aria-describedby` — so the reason reaches pointer and
   * keyboard users alike. Overrides `tooltip`/`title` for the visible tip while
   * disabled. Has no effect under `asChild` (the button is a Radix `Slot`).
   */
  disabledReason?: React.ReactNode;
}

type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

/**
 * Icon-only buttons (`size="icon"` / `"icon-sm"`) MUST be named — there's no
 * visible text. Enforced at the type level: a button must carry a `title`
 * (which becomes both the label and a tooltip), OR an explicit `aria-label`, OR
 * be a non-icon size. Phrasing it as "labeled OR non-icon" (rather than
 * discriminating on `size`) keeps dynamic `size={cond ? 'sm' : 'icon'}` buttons
 * valid as long as they're labeled — a plain `size`-discriminated union would
 * reject those outright.
 */
export type ButtonProps = ButtonOwnProps &
  (
    | ({ size?: ButtonSize | null } & { 'aria-label': string })
    | ({ size?: ButtonSize | null } & { title: string })
    | { size?: Exclude<ButtonSize, 'icon' | 'icon-sm'> | null }
  );

// Loose internal props — the wrapper has already resolved title → aria-label
// and stripped the tooltip props, so the base never sees them. `softDisabled`
// is set by the wrapper when a disabled button must stay focusable/hoverable to
// surface a `disabledReason` tooltip (see the Button wrapper below).
type ButtonBaseProps = ButtonOwnProps & {
  size?: ButtonSize | null;
  softDisabled?: boolean;
};

// Plain control — the real button. No skeleton/tooltip logic of its own.
const ButtonBase = React.forwardRef<HTMLButtonElement, ButtonBaseProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      isLoading = false,
      icon: Icon,
      iconClassName,
      fullWidth = false,
      collapseLabel = false,
      softDisabled = false,
      disabled,
      disabledReason: _disabledReason,
      onClick,
      onKeyDown,
      type,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    const isDisabled = isLoading || disabled;
    // Soft-disable keeps the control in the tab order and emitting pointer
    // events (so a disabledReason tooltip reaches both pointer and keyboard
    // users) while making activation inert — the native `disabled` attribute
    // would remove it from the tab order and silence all events.
    const soft = softDisabled && Boolean(isDisabled) && !asChild;
    const blockActivation = (
      event: React.SyntheticEvent & { key?: string },
    ) => {
      // Space/Enter activate a button; let other keys (Tab, arrows) through.
      if ('key' in event && event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
    };
    const iconClass = cn(
      'size-4',
      children && (collapseLabel ? 'sm:mr-2' : 'mr-2'),
      iconClassName,
    );

    // When collapsed, keep the label in the a11y tree (sr-only) so the button
    // still has an accessible name on mobile, revealing it from `sm` up.
    const label =
      collapseLabel && children ? (
        <span className="sr-only sm:not-sr-only">{children}</span>
      ) : (
        children
      );

    const leading = isLoading ? (
      <Loader2
        key="leading"
        className={cn(iconClass, 'animate-spin motion-reduce:animate-none')}
        aria-hidden="true"
      />
    ) : Icon ? (
      <Icon key="leading" className={iconClass} aria-hidden="true" />
    ) : null;

    // Under `asChild` the single child element (e.g. a Link) IS the rendered
    // control, so a leading icon/spinner must be injected as its sibling via
    // `Slottable` — Radix then merges props onto that child and keeps the icon
    // inside it. The icon and `Slottable` are passed as an ARRAY (direct Slot
    // children), never a Fragment: Slot doesn't descend into a Fragment to find
    // the `Slottable`, and forwarding `className` onto a Fragment triggers
    // React's "Invalid prop `className` supplied to `React.Fragment`" (#1976).
    // With no leading element the child is passed straight through.
    const content = asChild ? (
      leading ? (
        [leading, <Slottable key="child">{children}</Slottable>]
      ) : (
        children
      )
    ) : (
      <>
        {leading}
        {label}
      </>
    );

    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size, className }),
          fullWidth && 'w-full',
        )}
        ref={ref}
        disabled={soft ? undefined : isDisabled || undefined}
        aria-busy={isLoading || undefined}
        aria-disabled={isDisabled || undefined}
        // A soft-disabled button keeps emitting events to surface its tooltip,
        // so inside a <form> it would otherwise act as an implicit submit
        // button. Activation is already blocked by `blockActivation`, but
        // defaulting `type` to "button" is robust defense-in-depth; an explicit
        // caller `type` always wins.
        type={soft ? (type ?? 'button') : type}
        onClick={soft ? blockActivation : onClick}
        onKeyDown={soft ? blockActivation : onKeyDown}
        {...props}
      >
        {content}
      </Comp>
    );
  },
);
ButtonBase.displayName = 'ButtonBase';

/**
 * Skeleton-aware Button. Always wraps the real button in a `<SkeletonBox>`
 * (`ButtonBase` stays separate only to keep the markup tidy): idle, the box is
 * `display: contents`; inside a `<Skeletonize loading>` it masks the button
 * with an overlay at its exact size.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      tooltip,
      tooltipSide,
      tooltipOpen,
      onTooltipOpenChange,
      title,
      disabledReason,
      'aria-label': ariaLabel,
      ...props
    },
    ref,
  ) => {
    // `title` shows a tooltip for any button, and ALSO names icon-only buttons
    // (they have no visible text). Text buttons keep their accessible name from
    // their children — `title` must NOT override it there — so the name only
    // falls back to `title` for `size="icon"`. The native `title` attribute is
    // dropped either way so the browser doesn't pop a duplicate tooltip.
    const accessibleName =
      ariaLabel ??
      (props.size === 'icon' || props.size === 'icon-sm' ? title : undefined);
    // While disabled, a `disabledReason` explains why and takes over the visible
    // tip. It needs the button kept focusable/hoverable (soft-disable), which
    // can't work through a Radix `Slot`, so it's suppressed under `asChild`.
    const showDisabledReason =
      Boolean(props.disabled) &&
      hasDisabledReason(disabledReason) &&
      !props.asChild;
    const tip = showDisabledReason ? disabledReason : (tooltip ?? title);
    const base = (
      <ButtonBase
        {...props}
        aria-label={accessibleName}
        softDisabled={showDisabledReason}
        ref={ref}
      />
    );
    // The tooltip Trigger must wrap the REAL button (`ButtonBase` forwards its
    // ref + props), never the `SkeletonBox` span — a plain span drops the
    // Trigger's injected handlers/ref, leaving the tooltip permanently shut.
    // So the Trigger goes inside and `SkeletonBox` wraps the whole thing.
    // No tooltip when `asChild` — the button is then a Radix `Slot` (typically
    // another overlay's trigger), and wrapping a Slot in a tooltip trigger
    // breaks that composition.
    const withTooltip =
      tip == null || props.asChild ? (
        base
      ) : (
        <TooltipPrimitive.Provider delayDuration={300}>
          <TooltipPrimitive.Root
            open={tooltipOpen}
            onOpenChange={onTooltipOpenChange}
          >
            <TooltipPrimitive.Trigger asChild>{base}</TooltipPrimitive.Trigger>
            <TooltipPrimitive.Portal>
              <TooltipContent side={tooltipSide}>{tip}</TooltipContent>
            </TooltipPrimitive.Portal>
          </TooltipPrimitive.Root>
        </TooltipPrimitive.Provider>
      );
    return <SkeletonBox fullWidth={props.fullWidth}>{withTooltip}</SkeletonBox>;
  },
);
Button.displayName = 'Button';

export interface LinkButtonProps extends VariantProps<typeof buttonVariants> {
  /** Target URL for the link */
  href: string;
  /** Route params for dynamic segments (e.g. { id: '123' } for /dashboard/$id) */
  params?: Record<string, string>;
  /** Search params for the target route (e.g. { project: '123' }) */
  search?: Record<string, string>;
  /** Icon to display before the button text */
  icon?: LucideIcon;
  /** Additional className for the icon */
  iconClassName?: string;
  /** Additional className */
  className?: string;
  /** Children */
  children?: React.ReactNode;
  /** Prefetch the route */
  prefetch?: boolean;
  /**
   * Collapse the text label to an icon-only link below the `sm` breakpoint.
   * The label stays in the accessibility tree (visually hidden) so the link
   * keeps its accessible name on mobile, then becomes visible from `sm` up.
   */
  collapseLabel?: boolean;
}

/**
 * A Link component styled as a button.
 * Use this instead of wrapping Button with asChild around Link.
 */
export const LinkButton = React.forwardRef<HTMLAnchorElement, LinkButtonProps>(
  (
    {
      className,
      variant,
      size,
      icon: Icon,
      iconClassName,
      collapseLabel = false,
      children,
      href,
      params,
      search,
      prefetch,
    },
    ref,
  ) => {
    const iconClass = cn(
      'size-4',
      children && (collapseLabel ? 'sm:mr-2' : 'mr-2'),
      iconClassName,
    );

    return (
      <Link
        to={href}
        params={params}
        search={search}
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        preload={prefetch ? 'intent' : false}
      >
        {Icon && <Icon className={iconClass} aria-hidden="true" />}
        {collapseLabel && children ? (
          <span className="sr-only sm:not-sr-only">{children}</span>
        ) : (
          children
        )}
      </Link>
    );
  },
);
LinkButton.displayName = 'LinkButton';
