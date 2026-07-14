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
      body: 'text-sm text-foreground',
      /** Small body text — text-xs text-foreground */
      'body-sm': 'text-xs text-foreground',
      /** Muted description — text-sm text-muted-foreground */
      muted: 'text-sm text-muted-foreground',
      /** Small caption/metadata — text-xs text-muted-foreground */
      caption: 'text-xs text-muted-foreground',
      /** Form/field label — text-sm font-medium text-foreground */
      label: 'text-sm font-medium text-foreground',
      /** Small label — text-xs font-medium text-foreground */
      'label-sm': 'text-xs font-medium text-foreground',
      /** Monospace/code — text-xs font-mono */
      code: 'text-xs font-mono',
      /** Error text — text-sm text-destructive */
      error: 'text-sm text-destructive',
      /** Small error text — text-xs text-destructive font-medium */
      'error-sm': 'text-xs text-destructive font-medium',
      /** Success text — text-sm font-medium text-success */
      success: 'text-sm font-medium text-success',
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
