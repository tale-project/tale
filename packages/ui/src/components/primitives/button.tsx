import { Slot } from '@radix-ui/react-slot';
import { Link } from '@tanstack/react-router';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2, type LucideIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '../../lib/cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-150 active:scale-[0.97] active:duration-75 motion-reduce:active:scale-100 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 leading-none ring-offset-background cursor-pointer',
  {
    variants: {
      size: {
        default: 'px-4 py-3 grow-0',
        sm: 'rounded-md px-3 py-2 text-xs grow-0',
        lg: 'px-8 py-3.5',
        icon: 'p-2',
      },
      variant: {
        primary:
          'bg-accent-base text-accent-fg shadow-[0_1px_1.75px_rgba(3,7,18,0.4),0_0_0_1px_rgba(3,7,18,1)] hover:opacity-95 ring-1 ring-inset ring-white/20 [background-image:linear-gradient(to_bottom,rgba(255,255,255,0.16),rgba(255,255,255,0))]',
        destructive:
          'bg-destructive text-destructive-foreground -outline-offset-1 outline-destructive shadow-sm hover:bg-destructive/90',
        success:
          'bg-success text-success-foreground -outline-offset-1 outline-success shadow-sm hover:bg-success/90',
        secondary:
          'bg-bg-base text-fg-base ring-1 ring-border-strong ring-inset shadow-sm hover:bg-bg-elevated',
        ghost: 'text-fg-base hover:bg-bg-elevated',
        link: 'text-fg-base px-0 py-1 relative after:content-[""] after:block after:w-full after:h-[1px] after:transition-all after:duration-300 after:ease-in-out after:absolute after:bottom-0 after:left-0 hover:after:bg-fg-base',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  isLoading?: boolean;
  /** Icon to display before the button text */
  icon?: LucideIcon;
  /** Additional className for the icon */
  iconClassName?: string;
  /** Make button full width */
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
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
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    const iconClass = cn('size-4', children && 'mr-2', iconClassName);

    const content =
      asChild && !isLoading && !Icon ? (
        children
      ) : isLoading ? (
        <>
          <Loader2
            className={cn(iconClass, 'animate-spin motion-reduce:animate-none')}
            aria-hidden="true"
          />
          {children}
        </>
      ) : (
        <>
          {Icon ? <Icon className={iconClass} aria-hidden="true" /> : null}
          {children}
        </>
      );

    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size, className }),
          fullWidth && 'w-full',
        )}
        ref={ref}
        disabled={isLoading || props.disabled}
        aria-busy={isLoading || undefined}
        aria-disabled={isLoading || props.disabled || undefined}
        {...props}
      >
        {content}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export interface LinkButtonProps extends VariantProps<typeof buttonVariants> {
  /** Target URL for the link */
  href: string;
  /** Route params for dynamic segments (e.g. { id: '123' } for /dashboard/$id) */
  params?: Record<string, string>;
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
      children,
      href,
      params,
      prefetch,
    },
    ref,
  ) => {
    const iconClass = cn('size-4', children && 'mr-2', iconClassName);

    return (
      <Link
        to={href}
        params={params}
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        preload={prefetch ? 'intent' : false}
      >
        {Icon && <Icon className={iconClass} aria-hidden="true" />}
        {children}
      </Link>
    );
  },
);
LinkButton.displayName = 'LinkButton';
