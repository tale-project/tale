'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface WebsiteSearchProps {
  organizationId: string;
  currentSearch?: string;
}

export default function WebsiteSearch({
  organizationId: _organizationId,
  currentSearch = '',
}: WebsiteSearchProps) {
  const { t: tWebsites } = useT('websites');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchTerm, setSearchTerm] = useState(currentSearch);

  useEffect(() => {
    setSearchTerm(currentSearch);
  }, [currentSearch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());

      if (searchTerm) {
        params.set('query', searchTerm);
        params.set('page', '1'); // Reset to first page on search
      } else {
        params.delete('query');
      }

      router.push(`${pathname}?${params.toString()}`);
    }, 300); // Debounce delay

    return () => clearTimeout(timer);
  }, [searchTerm, router, pathname, searchParams]);

  return (
    <div className="relative w-full max-w-md">
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="text"
        placeholder={tWebsites('searchPlaceholder')}
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="pl-9"
      />
    </div>
  );
}
