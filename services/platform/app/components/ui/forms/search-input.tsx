'use client';

import { forwardRef, type InputHTMLAttributes, type ChangeEvent } from 'react';
import { Search } from 'lucide-react';

import { cn } from '@/lib/utils/cn';
import { Input } from './input';

export interface SearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
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
          className="absolute left-3 top-1/2 transform -translate-y-1/2 size-4 text-muted-foreground"
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
