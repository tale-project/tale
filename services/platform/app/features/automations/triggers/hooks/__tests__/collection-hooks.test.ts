import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCollection = Symbol('collection');

vi.mock('@tanstack/react-db', () => ({
  useLiveQuery: vi.fn((_builder: (q: unknown) => unknown) => {
    return { data: [], isLoading: false };
  }),
}));

vi.mock('@/lib/collections/entities/wf-schedules', () => ({
  createWfSchedulesCollection: vi.fn(),
}));

vi.mock('@/lib/collections/entities/wf-webhooks', () => ({
  createWfWebhooksCollection: vi.fn(),
}));

vi.mock('@/lib/collections/entities/wf-event-subscriptions', () => ({
  createWfEventSubscriptionsCollection: vi.fn(),
}));

vi.mock('@/lib/collections/use-collection', () => ({
  useCollection: vi.fn(() => mockCollection),
}));

import { useLiveQuery } from '@tanstack/react-db';

import { useCollection } from '@/lib/collections/use-collection';

import {
  useScheduleCollection,
  useWebhookCollection,
  useEventSubscriptionCollection,
} from '../collections';
import { useSchedules, useWebhooks, useEventSubscriptions } from '../queries';

const mockUseLiveQuery = vi.mocked(useLiveQuery);

describe('useScheduleCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates collection with correct params', () => {
    useScheduleCollection('wf-root-123');
    expect(useCollection).toHaveBeenCalledWith(
      'wf-schedules',
      expect.any(Function),
      'wf-root-123',
    );
  });
});

describe('useWebhookCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates collection with correct params', () => {
    useWebhookCollection('wf-root-123');
    expect(useCollection).toHaveBeenCalledWith(
      'wf-webhooks',
      expect.any(Function),
      'wf-root-123',
    );
  });
});

describe('useEventSubscriptionCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates collection with correct params', () => {
    useEventSubscriptionCollection('wf-root-123');
    expect(useCollection).toHaveBeenCalledWith(
      'wf-event-subscriptions',
      expect.any(Function),
      'wf-root-123',
    );
  });
});

describe('useSchedules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns data when loaded', () => {
    const schedules = [{ _id: '1' }, { _id: '2' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: schedules,
      isLoading: false,
    } as ReturnType<typeof useLiveQuery>);

    const result = useSchedules(mockCollection as never);
    expect(result.schedules).toBe(schedules);
    expect(result.isLoading).toBe(false);
  });

  it('returns data even while loading', () => {
    const mockData = [{ _id: '1', name: 'Test' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: mockData,
      isLoading: true,
    } as ReturnType<typeof useLiveQuery>);

    const result = useSchedules(mockCollection as never);
    expect(result.schedules).toBe(mockData);
    expect(result.isLoading).toBe(true);
  });
});

describe('useWebhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns data when loaded', () => {
    const webhooks = [{ _id: '1' }, { _id: '2' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: webhooks,
      isLoading: false,
    } as ReturnType<typeof useLiveQuery>);

    const result = useWebhooks(mockCollection as never);
    expect(result.webhooks).toBe(webhooks);
    expect(result.isLoading).toBe(false);
  });

  it('returns data even while loading', () => {
    const mockData = [{ _id: '1', name: 'Test' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: mockData,
      isLoading: true,
    } as ReturnType<typeof useLiveQuery>);

    const result = useWebhooks(mockCollection as never);
    expect(result.webhooks).toBe(mockData);
    expect(result.isLoading).toBe(true);
  });
});

describe('useEventSubscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns data when loaded', () => {
    const subscriptions = [{ _id: '1' }, { _id: '2' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: subscriptions,
      isLoading: false,
    } as ReturnType<typeof useLiveQuery>);

    const result = useEventSubscriptions(mockCollection as never);
    expect(result.subscriptions).toBe(subscriptions);
    expect(result.isLoading).toBe(false);
  });

  it('returns data even while loading', () => {
    const mockData = [{ _id: '1', name: 'Test' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: mockData,
      isLoading: true,
    } as ReturnType<typeof useLiveQuery>);

    const result = useEventSubscriptions(mockCollection as never);
    expect(result.subscriptions).toBe(mockData);
    expect(result.isLoading).toBe(true);
  });
});
