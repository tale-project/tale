import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2, type LucideIcon } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils/cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 leading-none ring-offset-background cursor-pointer',
  {
    variants: {
      size: {
        default: 'px-4 py-3 h-9 grow-0',
        sm: 'rounded-md px-3 py-2 text-xs h-8 grow-0',
        lg: 'px-8 py-3.5 h-10',
        icon: 'p-2',
      },
      variant: {
        default:
          'text-primary-foreground hover:from-primary/80 hover:to-primary/90 bg-gradient-to-b from-primary/90 from-0% to-primary to-100% outline outline-border/50 -outline-offset-1',
        destructive:
          'bg-destructive text-destructive-foreground -outline-offset-1 outline-destructive shadow-sm hover:bg-destructive/90',
        success:
          'bg-success text-success-foreground -outline-offset-1 outline-success shadow-sm hover:bg-success/90',
        outline:
          'ring-1 ring-border shadow-sm hover:bg-accent hover:text-accent-foreground bg-transparent',
        secondary:
          'bg-muted text-secondary-foreground shadow-sm ring-1 ring-border hover:ring-muted-foreground',
        ghost:
          'text-secondary-foreground hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary px-0 py-1 relative after:content-[""] after:block after:w-full after:h-[1px] after:transition-all after:duration-300 after:ease-in-out after:absolute after:bottom-0 after:left-0 hover:after:bg-primary',
        primary:
          'outline outline-white/20 bg-gradient-to-b from-[rgba(255,255,255,0.16)0%] from-0% to-white/0 to-100% bg-[#0561E6] shadow-[0_0_0_1px_#023173,0_1px_2px_0_#023173] text-white',
      },
    },
    defaultVariants: {
      variant: 'default',
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
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    const iconClass = cn('size-4', children && 'mr-2', iconClassName);

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={isLoading || props.disabled}
        {...props}
      >
        {isLoading ? (
          <>
            <Loader2 className={cn(iconClass, 'animate-spin')} />
            {children}
          </>
        ) : (
          <>
            {Icon && <Icon className={iconClass} />}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export interface LinkButtonProps
  extends
    Omit<React.ComponentProps<typeof Link>, 'className'>,
    VariantProps<typeof buttonVariants> {
  /** Icon to display before the button text */
  icon?: LucideIcon;
  /** Additional className for the icon */
  iconClassName?: string;
  /** Additional className */
  className?: string;
}

/**
 * A Link component styled as a button.
 * Use this instead of wrapping Button with asChild around Link.
 */
export const LinkButton = React.forwardRef<HTMLAnchorElement, LinkButtonProps>(
  (
    { className, variant, size, icon: Icon, iconClassName, children, ...props },
    ref,
  ) => {
    const iconClass = cn('size-4', children && 'mr-2', iconClassName);

    return (
      <Link
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      >
        {Icon && <Icon className={iconClass} />}
        {children}
      </Link>
    );
  },
);
LinkButton.displayName = 'LinkButton';
