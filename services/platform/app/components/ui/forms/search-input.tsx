'use client';

import { Search } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes, type ChangeEvent } from 'react';

import { cn } from '@/lib/utils/cn';

import { Input } from './input';

interface SearchInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'size' | 'type'
> {
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  wrapperClassName?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(
  ({ className, wrapperClassName, ...props }, ref) => {
    return (
      <div className={cn('relative', wrapperClassName)}>
        <Search
          className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2 transform"
          aria-hidden="true"
        />
        <Input
          ref={ref}
          type="text"
          size="sm"
          className={cn('pl-10', className)}
          {...props}
        />
      </div>
    );
  },
);

SearchInput.displayName = 'SearchInput';
