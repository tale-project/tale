'use client';

import { Heading } from '@tale/ui/heading';
import { cva, type VariantProps } from 'class-variance-authority';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { type ComponentType, type ReactNode } from 'react';

import { cn } from '../../lib/cn';

const alertVariants = cva(
  'relative w-full min-w-0 rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground',
  {
    variants: {
      // A real banner = a soft tinted fill + a colored icon, with neutral
      // readable title/body. The accent lives in the background + icon (+
      // border), not in a wall of colored text.
      variant: {
        default: 'bg-background text-foreground',
        destructive:
          'border-destructive/25 bg-destructive/10 text-foreground [&>svg]:text-destructive',
        warning:
          'border-amber-500/30 bg-amber-50 text-foreground dark:bg-amber-950/30 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-500',
        info: 'border-blue-500/30 bg-blue-50 text-foreground dark:bg-blue-950/30 [&>svg]:text-blue-600 dark:[&>svg]:text-blue-400',
        success:
          'border-green-500/30 bg-green-50 text-foreground dark:bg-green-950/30 [&>svg]:text-green-600 dark:[&>svg]:text-green-500',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

// A banner always carries its severity glyph — text alone doesn't scan, and
// color alone fails WCAG 1.4.1 (use of color). Callers may pass `icon` to
// sharpen the metaphor (a lock, a clock); omitting it falls back to the
// variant's glyph, never to no icon.
const DEFAULT_ICONS: Record<
  NonNullable<AlertProps['variant']>,
  ComponentType<{ className?: string }>
> = {
  default: Info,
  info: Info,
  warning: AlertTriangle,
  destructive: AlertCircle,
  success: CheckCircle2,
};

interface AlertProps extends VariantProps<typeof alertVariants> {
  icon?: ComponentType<{ className?: string }>;
  title?: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Urgency level for screen reader announcement */
  live?: 'polite' | 'assertive' | 'off';
  className?: string;
}

export function Alert({
  variant,
  icon,
  title,
  description,
  children,
  live = 'polite',
  className,
}: AlertProps) {
  // `live: 'off'` renders a STATIC banner — no `role="alert"`, so an
  // always-present strip (e.g. a settings danger zone) is not announced as a
  // live region on mount. Transient alerts keep the announcing default.
  const isLive = live !== 'off';
  const Icon = icon ?? DEFAULT_ICONS[variant ?? 'default'];
  return (
    <div
      role={isLive ? 'alert' : undefined}
      aria-live={live}
      aria-atomic="true"
      className={cn(alertVariants({ variant }), className)}
    >
      <Icon className="size-4" aria-hidden="true" />

      {title && (
        <Heading
          level={5}
          size="sm"
          weight="medium"
          tracking="tight"
          className="mb-1 leading-none"
        >
          {title}
        </Heading>
      )}
      {/* Body is muted for hierarchy under the foreground title — the variant
          color lives on the border, icon, and tint, not on a wall of colored
          text. */}
      {description && (
        <div className="text-muted-foreground text-sm break-words [&_p]:leading-relaxed">
          {description}
        </div>
      )}
      {children && (
        <div className="text-muted-foreground break-words">{children}</div>
      )}
    </div>
  );
}
