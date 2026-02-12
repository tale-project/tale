import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tanstack/react-db', () => ({
  createCollection: vi.fn((options: unknown) => ({
    _options: options,
    _id: Math.random().toString(36),
  })),
}));

import { createCollection } from '@tanstack/react-db';

import {
  getOrCreateCollection,
  clearCollections,
} from '../collection-registry';

const mockCreateCollection = vi.mocked(createCollection);

const mockQueryClient = {} as Parameters<typeof getOrCreateCollection>[3];
const mockConvexQueryFn = vi.fn();
const mockConvexClient = {} as Parameters<typeof getOrCreateCollection>[5];
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Test mock: simplified factory return type; createCollection is also mocked to accept any options
const mockFactory = vi.fn((orgId: string) => ({
  id: `test-${orgId}`,
  _factory: true,
})) as unknown as Parameters<typeof getOrCreateCollection>[2];

describe('collection-registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCollections();
  });

  describe('getOrCreateCollection', () => {
    it('creates a new collection on first call', () => {
      const result = getOrCreateCollection(
        'products',
        'org-123',
        mockFactory,
        mockQueryClient,
        mockConvexQueryFn,
        mockConvexClient,
      );

      expect(mockFactory).toHaveBeenCalledWith(
        'org-123',
        mockQueryClient,
        mockConvexQueryFn,
        mockConvexClient,
      );
      expect(mockCreateCollection).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
    });

    it('returns cached collection on subsequent calls with same key', () => {
      const first = getOrCreateCollection(
        'products',
        'org-123',
        mockFactory,
        mockQueryClient,
        mockConvexQueryFn,
        mockConvexClient,
      );
      const second = getOrCreateCollection(
        'products',
        'org-123',
        mockFactory,
        mockQueryClient,
        mockConvexQueryFn,
        mockConvexClient,
      );

      expect(mockCreateCollection).toHaveBeenCalledTimes(1);
      expect(first).toBe(second);
    });

    it('creates separate collections for different organizations', () => {
      const first = getOrCreateCollection(
        'products',
        'org-123',
        mockFactory,
        mockQueryClient,
        mockConvexQueryFn,
        mockConvexClient,
      );
      const second = getOrCreateCollection(
        'products',
        'org-456',
        mockFactory,
        mockQueryClient,
        mockConvexQueryFn,
        mockConvexClient,
      );

      expect(mockCreateCollection).toHaveBeenCalledTimes(2);
      expect(first).not.toBe(second);
    });

    it('creates separate collections for different names', () => {
      const first = getOrCreateCollection(
        'products',
        'org-123',
        mockFactory,
        mockQueryClient,
        mockConvexQueryFn,
        mockConvexClient,
      );
      const second = getOrCreateCollection(
        'customers',
        'org-123',
        mockFactory,
        mockQueryClient,
        mockConvexQueryFn,
        mockConvexClient,
      );

      expect(mockCreateCollection).toHaveBeenCalledTimes(2);
      expect(first).not.toBe(second);
    });
  });

  describe('clearCollections', () => {
    it('clears all collections when no organizationId provided', () => {
      getOrCreateCollection(
        'products',
        'org-123',
        mockFactory,
        mockQueryClient,
        mockConvexQueryFn,
        mockConvexClient,
      );
      getOrCreateCollection(
        'customers',
        'org-456',
        mockFactory,
        mockQueryClient,
        mockConvexQueryFn,
        mockConvexClient,
      );

      clearCollections();

      // After clearing, new calls should create fresh collections
      getOrCreateCollection(
        'products',
        'org-123',
        mockFactory,
        mockQueryClient,
        mockConvexQueryFn,
        mockConvexClient,
      );

      // 2 initial + 1 after clear
      expect(mockCreateCollection).toHaveBeenCalledTimes(3);
    });

    it('clears only collections for specified organization', () => {
      getOrCreateCollection(
        'products',
        'org-123',
        mockFactory,
        mockQueryClient,
        mockConvexQueryFn,
        mockConvexClient,
      );
      getOrCreateCollection(
        'products',
        'org-456',
        mockFactory,
        mockQueryClient,
        mockConvexQueryFn,
        mockConvexClient,
      );

      clearCollections('org-123');

      // org-123 should be recreated
      getOrCreateCollection(
        'products',
        'org-123',
        mockFactory,
        mockQueryClient,
        mockConvexQueryFn,
        mockConvexClient,
      );
      // org-456 should be cached still
      getOrCreateCollection(
        'products',
        'org-456',
        mockFactory,
        mockQueryClient,
        mockConvexQueryFn,
        mockConvexClient,
      );

      // 2 initial + 1 recreated for org-123
      expect(mockCreateCollection).toHaveBeenCalledTimes(3);
    });
  });
});
