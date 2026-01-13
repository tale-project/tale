'use client';

import { forwardRef, FormHTMLAttributes, HTMLAttributes } from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Form - Semantic form element with consistent vertical spacing
 * Use for wrapping form fields with proper layout and accessibility
 */
export const Form = forwardRef<HTMLFormElement, FormHTMLAttributes<HTMLFormElement>>(
  ({ className, ...props }, ref) => (
    <form ref={ref} className={cn('space-y-5', className)} {...props} />
  ),
);
Form.displayName = 'Form';

/**
 * FormRow - Arranges form fields horizontally with responsive breakpoints
 * Stacks vertically on mobile, side-by-side on larger screens
 */
export const FormRow = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col sm:flex-row gap-4', className)}
      {...props}
    />
  ),
);
FormRow.displayName = 'FormRow';

/**
 * FormGroup - Container for a single form field with consistent spacing
 * Wraps individual form elements for proper layout
 */
export const FormGroup = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('space-y-1.5', className)} {...props} />
  ),
);
FormGroup.displayName = 'FormGroup';

