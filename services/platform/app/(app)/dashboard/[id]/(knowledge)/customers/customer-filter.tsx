'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { FilterSection } from '@/components/filters/filter-section';
import { FilterButton } from '@/components/filters/filter-button';

type FilterSectionKey = 'status' | 'source' | 'locale';

export default function CustomerFilter() {
  const [isOpen, setIsOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<
    Record<FilterSectionKey, boolean>
  >({
    status: false,
    source: false,
    locale: false,
  });

  const router = useRouter();
  const searchParams = useSearchParams();

  // Get current filters from URL
  const statusFilters = searchParams.get('status')?.split(',') || [];
  const sourceFilters = searchParams.get('source')?.split(',') || [];
  const localeFilters = searchParams.get('locale')?.split(',') || [];

  const totalFilters =
    statusFilters.length + sourceFilters.length + localeFilters.length;

  const handleFilterChange = (
    filterType: 'status' | 'source' | 'locale',
    value: string,
    checked: boolean,
  ) => {
    const params = new URLSearchParams(searchParams.toString());
    const currentFilters =
      params.get(filterType)?.split(',').filter(Boolean) || [];

    let newFilters: string[];
    if (checked) {
      newFilters = [...currentFilters, value];
    } else {
      newFilters = currentFilters.filter((f) => f !== value);
    }

    if (newFilters.length > 0) {
      params.set(filterType, newFilters.join(','));
    } else {
      params.delete(filterType);
    }

    // Reset to first page when changing filters
    params.delete('page');

    router.push(`?${params.toString()}`);
  };

  const handleClearAll = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('status');
    params.delete('source');
    params.delete('locale');
    params.delete('page');
    router.push(`?${params.toString()}`);
    setIsOpen(false);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen} modal={false}>
      <PopoverTrigger asChild>
        <div>
          <FilterButton hasActiveFilters={totalFilters > 0} isLoading={false} />
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
        {/* Header */}
        <div className="flex items-center justify-between p-2">
          <h4 className="text-sm font-semibold text-foreground">Filters</h4>
          {totalFilters > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              className="text-xs text-primary hover:text-primary/80 font-medium"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Status Filter */}
        <FilterSection
          title="Status"
          isExpanded={expandedSections.status}
          onToggle={() =>
            setExpandedSections((prev) => ({
              ...prev,
              status: !prev.status,
            }))
          }
          active={statusFilters.length > 0}
        >
          {['active', 'potential', 'churned', 'lost'].map((status) => (
            <label
              key={status}
              className="flex items-center gap-2 cursor-pointer"
            >
              <Checkbox
                checked={statusFilters.includes(status)}
                onCheckedChange={(checked) =>
                  handleFilterChange('status', status, !!checked)
                }
              />
              <span className="text-sm text-muted-foreground capitalize">
                {status}
              </span>
            </label>
          ))}
        </FilterSection>

        {/* Source Filter */}
        <FilterSection
          title="Source"
          isExpanded={expandedSections.source}
          onToggle={() =>
            setExpandedSections((prev) => ({
              ...prev,
              source: !prev.source,
            }))
          }
          active={sourceFilters.length > 0}
        >
          {[
            { value: 'manual_import', label: 'Manual' },
            { value: 'file_upload', label: 'Upload' },
            { value: 'circuly', label: 'Circuly' },
          ].map((source) => (
            <label
              key={source.value}
              className="flex items-center gap-2 cursor-pointer"
            >
              <Checkbox
                checked={sourceFilters.includes(source.value)}
                onCheckedChange={(checked) =>
                  handleFilterChange('source', source.value, !!checked)
                }
              />
              <span className="text-sm text-muted-foreground">
                {source.label}
              </span>
            </label>
          ))}
        </FilterSection>

        {/* Locale Filter */}
        <FilterSection
          title="Locale"
          isExpanded={expandedSections.locale}
          onToggle={() =>
            setExpandedSections((prev) => ({
              ...prev,
              locale: !prev.locale,
            }))
          }
          active={localeFilters.length > 0}
        >
          <div className="grid grid-cols-2 gap-2">
            {['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'zh'].map((locale) => (
              <label
                key={locale}
                className="flex items-center gap-2 cursor-pointer"
              >
                <Checkbox
                  checked={localeFilters.includes(locale)}
                  onCheckedChange={(checked) =>
                    handleFilterChange('locale', locale, !!checked)
                  }
                />
                <span className="text-sm text-muted-foreground uppercase">
                  {locale}
                </span>
              </label>
            ))}
          </div>
        </FilterSection>
      </PopoverContent>
    </Popover>
  );
}
