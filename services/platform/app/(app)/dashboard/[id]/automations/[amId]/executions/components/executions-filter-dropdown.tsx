'use client';

import { useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { FilterSection } from '@/components/filters/filter-section';
import { FilterButton } from '@/components/filters/filter-button';
import { useT } from '@/lib/i18n';

export interface ExecutionsFilterState {
  status: string;
  triggeredBy: string;
  dateFrom: string | null;
  dateTo: string | null;
}

interface ExecutionsFilterDropdownProps {
  filters: ExecutionsFilterState;
  onFiltersChange: (filters: ExecutionsFilterState) => void;
  triggeredByOptions: string[];
  isLoading?: boolean;
}

export function ExecutionsFilterDropdown({
  filters,
  onFiltersChange,
  triggeredByOptions,
  isLoading = false,
}: ExecutionsFilterDropdownProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const [isOpen, setIsOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    dateRange: false,
    status: false,
    triggeredBy: false,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleClearAll = () => {
    onFiltersChange({
      status: 'All',
      triggeredBy: 'All',
      dateFrom: null,
      dateTo: null,
    });
    setIsOpen(false);
  };

  const hasActiveFilters =
    filters.status !== 'All' ||
    filters.triggeredBy !== 'All' ||
    filters.dateFrom !== null ||
    filters.dateTo !== null;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen} modal>
      <PopoverTrigger asChild>
        <div>
          <FilterButton
            hasActiveFilters={hasActiveFilters}
            isLoading={isLoading}
            onClick={() => setIsOpen(!isOpen)}
          />
        </div>
      </PopoverTrigger>
      <PopoverContent align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
        {/* Header */}
        <div className="flex items-center justify-between p-2">
          <h4 className="text-sm font-semibold text-foreground">{t('executions.filters.title')}</h4>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearAll}
              className="text-xs text-primary hover:text-primary/80 font-medium"
            >
              {tCommon('actions.clearAll')}
            </button>
          )}
        </div>

        {/* Date Range Section */}
        <FilterSection
          title={t('executions.filters.dateRange')}
          isExpanded={expandedSections.dateRange}
          onToggle={() => toggleSection('dateRange')}
          active={filters.dateFrom !== null || filters.dateTo !== null}
        >
          <div className="flex items-center gap-1">
            <Input
              type="date"
              value={filters.dateFrom || ''}
              onChange={(e) =>
                onFiltersChange({
                  ...filters,
                  dateFrom: e.target.value || null,
                })
              }
              size="sm"
              className="text-xs px-1.5 flex-1 w-[6rem]"
            />
            <span className="text-muted-foreground">-</span>
            <Input
              type="date"
              value={filters.dateTo || ''}
              onChange={(e) =>
                onFiltersChange({
                  ...filters,
                  dateTo: e.target.value || null,
                })
              }
              size="sm"
              className="text-xs px-1.5 flex-1 w-[6rem]"
            />
          </div>
        </FilterSection>

        {/* Status Section */}
        <FilterSection
          title={t('executions.filters.status')}
          isExpanded={expandedSections.status}
          onToggle={() => toggleSection('status')}
          active={filters.status !== 'All'}
        >
          <Select
            value={filters.status}
            onValueChange={(value) =>
              onFiltersChange({ ...filters, status: value })
            }
            className="h-8 text-xs"
            placeholder={t('executions.filters.status')}
            position="popper"
            sideOffset={4}
            options={[
              { value: 'All', label: t('executions.filters.allStatus') },
              { value: 'running', label: tCommon('status.running') },
              { value: 'completed', label: tCommon('status.completed') },
              { value: 'failed', label: tCommon('status.failed') },
              { value: 'pending', label: tCommon('status.pending') },
            ]}
          />
        </FilterSection>

        {/* Triggered By Section */}
        <FilterSection
          title={t('executions.filters.triggeredBy')}
          isExpanded={expandedSections.triggeredBy}
          onToggle={() => toggleSection('triggeredBy')}
          active={filters.triggeredBy !== 'All'}
        >
          <Select
            value={filters.triggeredBy}
            onValueChange={(value) =>
              onFiltersChange({ ...filters, triggeredBy: value })
            }
            className="h-8 text-xs"
            placeholder={t('executions.filters.triggeredBy')}
            position="popper"
            sideOffset={4}
            options={[
              { value: 'All', label: t('executions.filters.allTriggers') },
              ...triggeredByOptions.map((option) => ({
                value: option,
                label: option,
              })),
            ]}
          />
        </FilterSection>
      </PopoverContent>
    </Popover>
  );
}
