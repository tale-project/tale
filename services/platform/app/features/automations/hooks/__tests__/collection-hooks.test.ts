import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCollection = Symbol('collection');

vi.mock('@tanstack/react-db', () => ({
  useLiveQuery: vi.fn((_builder: (q: unknown) => unknown) => {
    return { data: [], isLoading: false };
  }),
}));

vi.mock('@/lib/collections/entities/automation-roots', () => ({
  createAutomationRootsCollection: vi.fn(),
}));

vi.mock('@/lib/collections/entities/wf-automations', () => ({
  createWfAutomationsCollection: vi.fn(),
}));

vi.mock('@/lib/collections/entities/wf-steps', () => ({
  createWfStepsCollection: vi.fn(),
}));

vi.mock('@/lib/collections/use-collection', () => ({
  useCollection: vi.fn(() => mockCollection),
}));

import { useLiveQuery } from '@tanstack/react-db';

import { useCollection } from '@/lib/collections/use-collection';

import {
  useAutomationRootCollection,
  useWfAutomationCollection,
  useWorkflowStepCollection,
  useAutomationRoots,
  useAutomations,
  useWorkflowSteps,
} from '../collections';

const mockUseLiveQuery = vi.mocked(useLiveQuery);

describe('useAutomationRootCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates collection with correct params', () => {
    useAutomationRootCollection('org-123');
    expect(useCollection).toHaveBeenCalledWith(
      'automation-roots',
      expect.any(Function),
      'org-123',
    );
  });
});

describe('useWfAutomationCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates collection with correct params', () => {
    useWfAutomationCollection('org-123');
    expect(useCollection).toHaveBeenCalledWith(
      'wf-automations',
      expect.any(Function),
      'org-123',
    );
  });
});

describe('useWorkflowStepCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates collection with correct params', () => {
    useWorkflowStepCollection('wf-def-123');
    expect(useCollection).toHaveBeenCalledWith(
      'wf-steps',
      expect.any(Function),
      'wf-def-123',
    );
  });
});

describe('useAutomationRoots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns data from live query', () => {
    const items = [{ _id: '1' }, { _id: '2' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: items,
      isLoading: false,
    } as ReturnType<typeof useLiveQuery>);

    const result = useAutomationRoots(mockCollection as never);
    expect(result.automationRoots).toBe(items);
    expect(result.isLoading).toBe(false);
  });

  it('returns empty array when loading', () => {
    mockUseLiveQuery.mockReturnValueOnce({
      data: [],
      isLoading: true,
    } as ReturnType<typeof useLiveQuery>);

    const result = useAutomationRoots(mockCollection as never);
    expect(result.automationRoots).toEqual([]);
    expect(result.isLoading).toBe(true);
  });
});

describe('useAutomations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns data from live query', () => {
    const items = [{ _id: '1' }, { _id: '2' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: items,
      isLoading: false,
    } as ReturnType<typeof useLiveQuery>);

    const result = useAutomations(mockCollection as never);
    expect(result.automations).toBe(items);
    expect(result.isLoading).toBe(false);
  });

  it('returns data even while loading', () => {
    const mockData = [{ _id: '1', name: 'Test' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: mockData,
      isLoading: true,
    } as ReturnType<typeof useLiveQuery>);

    const result = useAutomations(mockCollection as never);
    expect(result.automations).toBe(mockData);
    expect(result.isLoading).toBe(true);
  });
});

describe('useWorkflowSteps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns data when loaded', () => {
    const steps = [{ _id: '1' }, { _id: '2' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: steps,
      isLoading: false,
    } as ReturnType<typeof useLiveQuery>);

    const result = useWorkflowSteps(mockCollection as never);
    expect(result.steps).toBe(steps);
    expect(result.isLoading).toBe(false);
  });

  it('returns data even while loading', () => {
    const mockData = [{ _id: '1', name: 'Test' }];
    mockUseLiveQuery.mockReturnValueOnce({
      data: mockData,
      isLoading: true,
    } as ReturnType<typeof useLiveQuery>);

    const result = useWorkflowSteps(mockCollection as never);
    expect(result.steps).toBe(mockData);
    expect(result.isLoading).toBe(true);
  });
});
