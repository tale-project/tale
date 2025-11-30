'use client';

import { useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { FilterSection } from '@/components/filters/filter-section';
import { FilterButton } from '@/components/filters/filter-button';

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

export default function ExecutionsFilterDropdown({
  filters,
  onFiltersChange,
  triggeredByOptions,
  isLoading = false,
}: ExecutionsFilterDropdownProps) {
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
          <h4 className="text-sm font-semibold text-foreground">Filters</h4>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearAll}
              className="text-xs text-primary hover:text-primary/80 font-medium"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Date Range Section */}
        <FilterSection
          title="Date Range"
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
          title="Status"
          isExpanded={expandedSections.status}
          onToggle={() => toggleSection('status')}
          active={filters.status !== 'All'}
        >
          <Select
            value={filters.status}
            onValueChange={(value) =>
              onFiltersChange({ ...filters, status: value })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4}>
              <SelectItem value="All" className="text-xs">
                All status
              </SelectItem>
              <SelectItem value="running" className="text-xs">
                Running
              </SelectItem>
              <SelectItem value="completed" className="text-xs">
                Completed
              </SelectItem>
              <SelectItem value="failed" className="text-xs">
                Failed
              </SelectItem>
              <SelectItem value="pending" className="text-xs">
                Pending
              </SelectItem>
            </SelectContent>
          </Select>
        </FilterSection>

        {/* Triggered By Section */}
        <FilterSection
          title="Triggered By"
          isExpanded={expandedSections.triggeredBy}
          onToggle={() => toggleSection('triggeredBy')}
          active={filters.triggeredBy !== 'All'}
        >
          <Select
            value={filters.triggeredBy}
            onValueChange={(value) =>
              onFiltersChange({ ...filters, triggeredBy: value })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Triggered By" />
            </SelectTrigger>
            <SelectContent position="popper" sideOffset={4}>
              <SelectItem value="All" className="text-xs">
                All triggers
              </SelectItem>
              {triggeredByOptions.map((option) => (
                <SelectItem key={option} value={option} className="text-xs">
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterSection>
      </PopoverContent>
    </Popover>
  );
}
