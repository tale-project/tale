/**
 * Integration tests for filter expression parsing and index selection
 */

import { describe, it, expect } from 'vitest';

import { selectOptimalIndex } from './index_selection';
import { parseFilterExpression } from './parse_filter_expression';

describe('Integration: parseFilterExpression + selectOptimalIndex', () => {
  const organizationId = 'test-org-123';

  describe('conversation filters', () => {
    it('should select status index for status equality', () => {
      const result = selectOptimalIndex(
        'conversations',
        organizationId,
        'status == "open"',
      );

      expect(result.index.name).toBe('by_organizationId_and_status');
      expect(result.indexValues).toEqual({
        organizationId,
        status: 'open',
      });
      expect(result.requiresPostFilter).toBe(false);
      expect(result.indexableConditions).toHaveLength(1);
      expect(result.postFilterConditions).toHaveLength(0);
    });

    it('should handle complex expression with function call', () => {
      const result = selectOptimalIndex(
        'conversations',
        organizationId,
        'status == "closed" && daysAgo(metadata.resolved_at) > 30',
      );

      // Should use status index and post-filter the daysAgo condition
      expect(result.index.name).toBe('by_organizationId_and_status');
      expect(result.indexValues).toEqual({
        organizationId,
        status: 'closed',
      });
      expect(result.requiresPostFilter).toBe(true);
      expect(result.indexableConditions).toHaveLength(1);
    });

    it('should select priority index for priority comparison', () => {
      const result = selectOptimalIndex(
        'conversations',
        organizationId,
        'priority >= 5',
      );

      // Should select priority index with comparison condition
      expect(result.index.name).toBe('by_organizationId_and_priority');
      expect(result.indexValues).toEqual({ organizationId });
      expect(result.indexableConditions).toHaveLength(1);
      expect(result.indexableConditions[0].operator).toBe('>=');
    });
  });

  describe('approval filters', () => {
    it('should use compound index for status and resourceType', () => {
      const result = selectOptimalIndex(
        'approvals',
        organizationId,
        'status == "pending" && resourceType == "document"',
      );

      expect(result.index.name).toBe('by_org_status_resourceType');
      expect(result.indexValues).toEqual({
        organizationId,
        status: 'pending',
        resourceType: 'document',
      });
      expect(result.requiresPostFilter).toBe(false);
    });

    it('should handle out-of-order conditions', () => {
      const result = selectOptimalIndex(
        'approvals',
        organizationId,
        'resourceType == "document" && status == "pending"',
      );

      // Parser should extract both conditions regardless of order
      expect(result.indexableConditions).toHaveLength(2);
      // Index selection should handle order correctly
      expect(result.indexValues.status).toBe('pending');
      expect(result.indexValues.resourceType).toBe('document');
    });
  });

  describe('customer filters', () => {
    it('should handle multiple fields with mixed operators', () => {
      const result = selectOptimalIndex(
        'customers',
        organizationId,
        'status == "active" && locale == "en-US"',
      );

      // Should choose status index and post-filter locale
      // (since there's no compound status+locale index)
      expect(result.indexValues.status).toBe('active');
      expect(result.indexableConditions.length).toBeGreaterThan(0);
    });
  });

  describe('fallback behavior', () => {
    it('should fall back to basic index for no filter', () => {
      const result = selectOptimalIndex('conversations', organizationId);

      expect(result.index.name).toBe('by_organizationId');
      expect(result.indexValues).toEqual({ organizationId });
      expect(result.requiresPostFilter).toBe(false);
    });

    it('should fall back to basic index for OR expression', () => {
      const result = selectOptimalIndex(
        'conversations',
        organizationId,
        'status == "open" || status == "pending"',
      );

      // OR expressions are marked as complex, so no indexable conditions extracted
      // Falls back to basic organizationId index
      expect(result.requiresPostFilter).toBe(true);
      expect(result.indexableConditions).toHaveLength(0);
    });

    it('should require post-filter for unknown field', () => {
      const result = selectOptimalIndex(
        'conversations',
        organizationId,
        'unknownField == "value"',
      );

      // Unknown field is not in any index, so needs post-filtering
      expect(result.requiresPostFilter).toBe(true);
      // The condition was parsed successfully
      expect(result.postFilterConditions.length).toBeGreaterThan(0);
    });
  });

  describe('scoring prioritization', () => {
    it('should prefer equality over comparison', () => {
      const result = selectOptimalIndex(
        'conversations',
        organizationId,
        'status == "open" && priority > 5',
      );

      // Should choose status index (equality) over priority (comparison)
      expect(result.index.name).toBe('by_organizationId_and_status');
      expect(result.indexValues.status).toBe('open');
    });
  });

  describe('real-world workflow scenarios', () => {
    it('should handle conversation auto-archive workflow', () => {
      const parsed = parseFilterExpression(
        'status == "closed" && daysAgo(metadata.resolved_at) > 30',
      );

      expect(parsed.conditions).toHaveLength(1);
      expect(parsed.conditions[0].field).toBe('status');
      expect(parsed.hasComplexConditions).toBe(true);

      const selected = selectOptimalIndex(
        'conversations',
        organizationId,
        'status == "closed" && daysAgo(metadata.resolved_at) > 30',
      );

      expect(selected.index.name).toBe('by_organizationId_and_status');
      expect(selected.requiresPostFilter).toBe(true);
    });

    it('should handle product recommendation workflow', () => {
      const parsed = parseFilterExpression(
        'status == "active" && category == "electronics"',
      );

      expect(parsed.conditions).toHaveLength(2);
      expect(parsed.equalityConditions).toEqual({
        status: 'active',
        category: 'electronics',
      });

      const selected = selectOptimalIndex(
        'products',
        organizationId,
        'status == "active" && category == "electronics"',
      );

      // Products table has both status and category indexes
      expect(selected.indexValues.status).toBe('active');
    });

    it('should handle approval routing workflow', () => {
      const parsed = parseFilterExpression(
        'status == "pending" && resourceType == "document" && priority >= 5',
      );

      expect(parsed.conditions).toHaveLength(3);

      const selected = selectOptimalIndex(
        'approvals',
        organizationId,
        'status == "pending" && resourceType == "document" && priority >= 5',
      );

      // Should use compound index for status + resourceType
      expect(selected.index.name).toBe('by_org_status_resourceType');
      expect(selected.indexValues).toEqual({
        organizationId,
        status: 'pending',
        resourceType: 'document',
      });
      // priority condition requires post-filter
      expect(selected.requiresPostFilter).toBe(true);
    });
  });
});
