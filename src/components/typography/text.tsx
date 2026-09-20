'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import {
  useCallback,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';

import { cn } from '../../lib/cn';

export const textVariants = cva('', {
  variants: {
    variant: {
      /** Standard body text — text-sm text-foreground */
      body: 'text-foreground text-sm',
      /** Small body text — text-xs text-foreground */
      'body-sm': 'text-foreground text-xs',
      /** Muted description — text-sm text-muted-foreground */
      muted: 'text-muted-foreground text-sm',
      /** Small caption/metadata — text-xs text-muted-foreground */
      caption: 'text-muted-foreground text-xs',
      /** Form/field label — text-sm font-medium text-foreground */
      label: 'text-foreground text-sm font-medium',
      /** Small label — text-xs font-medium text-foreground */
      'label-sm': 'text-foreground text-xs font-medium',
      /** Monospace/code — text-xs font-mono */
      code: 'font-mono text-xs',
      /** Error text — text-sm text-destructive */
      error: 'text-destructive text-sm',
      /** Small error text — text-xs text-destructive font-medium */
      'error-sm': 'text-destructive text-xs font-medium',
      /** Success text — text-sm font-medium text-success */
      success: 'text-success text-sm font-medium',
    },
  },
  defaultVariants: {
    variant: 'body',
  },
});

export type TextVariant = NonNullable<
  VariantProps<typeof textVariants>['variant']
>;
type TextElement = 'p' | 'span' | 'div' | 'label' | 'h3';

interface TextProps extends HTMLAttributes<HTMLElement> {
  /** Semantic text style preset. */
  variant?: TextVariant;
  /** HTML element to render. Defaults to `p`. */
  as?: TextElement;
  /** Truncate with ellipsis. */
  truncate?: boolean;
  /** Text alignment. */
  align?: 'left' | 'center' | 'right';
  children?: ReactNode;
  ref?: Ref<HTMLElement>;
}

export function Text({
  as: Tag = 'p',
  variant,
  truncate,
  align,
  className,
  ref,
  ...props
}: TextProps) {
  return (
    <Tag
      ref={useCallback(
        (node: HTMLElement | null) => {
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        },
        [ref],
      )}
      className={cn(
        textVariants({ variant }),
        truncate && 'truncate',
        align === 'center' && 'text-center',
        align === 'right' && 'text-right',
        className,
      )}
      {...props}
    />
  );
}
