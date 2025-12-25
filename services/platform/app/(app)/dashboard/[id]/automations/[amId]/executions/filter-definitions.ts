import type { FilterDefinitions } from '@/lib/pagination/types';

export const executionFilterDefinitions = {
  query: {
    type: 'search' as const,
    urlKey: 'query',
    debounceMs: 300,
  },
  status: {
    type: 'multiSelect' as const,
    titleKey: 'tables.headers.status',
    options: [
      { value: 'running', labelKey: 'common.status.running' },
      { value: 'completed', labelKey: 'common.status.completed' },
      { value: 'failed', labelKey: 'common.status.failed' },
      { value: 'pending', labelKey: 'common.status.pending' },
    ],
  },
  triggeredBy: {
    type: 'multiSelect' as const,
    titleKey: 'automations.executions.filters.triggeredBy',
    options: [], // Dynamic options from data - will be filtered in-memory
  },
  dateRange: {
    type: 'dateRange' as const,
    titleKey: 'automations.executions.filters.dateRange',
  },
} as const satisfies FilterDefinitions;
