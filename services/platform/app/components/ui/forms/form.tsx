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


