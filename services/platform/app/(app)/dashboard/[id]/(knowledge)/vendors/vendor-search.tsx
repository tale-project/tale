'use client';

import {
  ChangeEvent,
  FocusEvent,
  KeyboardEvent,
  useState,
  useTransition,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface VendorSearchProps {
  organizationId: string;
  currentSearch?: string;
}

export default function VendorSearch({
  organizationId: _organizationId,
  currentSearch = '',
}: VendorSearchProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(currentSearch);
  const [isPending, startTransition] = useTransition();

  const handleQueryChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setQuery(newValue);
  };

  const handleSearch = () => {
    const params = new URLSearchParams(searchParams.toString());
    const trimmedQuery = query.trim();
    if (trimmedQuery) {
      params.set('query', trimmedQuery);
    } else {
      params.delete('query');
    }
    // Reset to first page when searching
    params.delete('page');
    startTransition(() => {
      router.push(`?${params.toString()}`);
    });
  };

  const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
    const newValue = e.target.value.trim();
    // Only trigger search on blur if the query has been cleared
    if (!newValue && searchParams.get('query')) {
      startTransition(() => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete('query');
        params.delete('page');
        router.push(`?${params.toString()}`);
      });
    }
  };

  const handleQueryKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <div className="relative sm:w-[300px] w-full">
      <div className="absolute top-1/2 left-3 -translate-y-1/2">
        {isPending ? (
          <Loader2 className="size-4 animate-spin0" />
        ) : (
          <Search className="size-4" />
        )}
      </div>
      <Input
        value={query}
        onKeyDown={handleQueryKeyDown}
        onChange={handleQueryChange}
        onBlur={handleBlur}
        placeholder="Search product"
        className="pl-10"
        disabled={isPending}
      />
    </div>
  );
}
