'use client';

import { ChangeEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface CustomerSearchProps {
  currentSearch?: string;
}

export default function CustomerSearch({
  currentSearch = '',
}: CustomerSearchProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(currentSearch);

  const handleSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    const params = new URLSearchParams(searchParams);
    if (value.trim().length > 0) {
      params.set('query', value.trim());
    } else {
      params.delete('query');
    }
    params.delete('page'); // Reset to first page when searching
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="relative w-full sm:w-[300px]">
      <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
      <Input
        value={query}
        onChange={handleSearchChange}
        placeholder="Search customers"
        className="pl-8"
      />
    </div>
  );
}
