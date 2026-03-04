import { describe, expect, it } from 'vitest';

import {
  getAcceptForTools,
  getAllowedMimeTypesForTools,
  hasFileTools,
} from '../file-types';

describe('tool → file type mapping', () => {
  describe('getAcceptForTools', () => {
    it('returns image accept string when image tool is enabled', () => {
      const result = getAcceptForTools(['image']);
      expect(result).toContain('image/*');
    });

    it('returns pdf accept string when pdf tool is enabled', () => {
      const result = getAcceptForTools(['pdf']);
      expect(result).toContain('.pdf');
    });

    it('returns combined accept for multiple document tools', () => {
      const result = getAcceptForTools(['pdf', 'image', 'docx']);
      expect(result).toBeDefined();
      expect(result).toContain('image/*');
      expect(result).toContain('.pdf');
      expect(result).toContain('.doc');
      expect(result).toContain('.docx');
    });

    it('returns undefined when no document tools are enabled', () => {
      const result = getAcceptForTools(['web', 'rag_search']);
      expect(result).toBeUndefined();
    });

    it('returns undefined for empty tool list', () => {
      const result = getAcceptForTools([]);
      expect(result).toBeUndefined();
    });

    it('ignores non-document tool names', () => {
      const result = getAcceptForTools(['web', 'pdf', 'customer_read']);
      expect(result).toContain('.pdf');
      expect(result).not.toContain('web');
    });

    it('includes spreadsheet extensions for excel tool', () => {
      const result = getAcceptForTools(['excel']);
      expect(result).toContain('.xls');
      expect(result).toContain('.xlsx');
      expect(result).toContain('.csv');
    });

    it('includes presentation extensions for pptx tool', () => {
      const result = getAcceptForTools(['pptx']);
      expect(result).toContain('.ppt');
      expect(result).toContain('.pptx');
    });
  });

  describe('getAllowedMimeTypesForTools', () => {
    it('returns image MIME types for image tool', () => {
      const result = getAllowedMimeTypesForTools(['image']);
      expect(result).toContain('image/jpeg');
      expect(result).toContain('image/png');
      expect(result).toContain('image/gif');
      expect(result).toContain('image/webp');
    });

    it('returns pdf MIME type for pdf tool', () => {
      const result = getAllowedMimeTypesForTools(['pdf']);
      expect(result).toEqual(['application/pdf']);
    });

    it('returns undefined when no document tools are enabled', () => {
      const result = getAllowedMimeTypesForTools(['web', 'rag_search']);
      expect(result).toBeUndefined();
    });

    it('combines MIME types for multiple tools', () => {
      const result = getAllowedMimeTypesForTools(['pdf', 'image']);
      expect(result).toBeDefined();
      expect(result).toContain('application/pdf');
      expect(result).toContain('image/jpeg');
    });

    it('includes spreadsheet MIME types for excel tool', () => {
      const result = getAllowedMimeTypesForTools(['excel']);
      expect(result).toContain('application/vnd.ms-excel');
      expect(result).toContain(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(result).toContain('text/csv');
    });
  });

  describe('hasFileTools', () => {
    it('returns true when document tools are present', () => {
      expect(hasFileTools(['pdf', 'web'])).toBe(true);
      expect(hasFileTools(['image'])).toBe(true);
      expect(hasFileTools(['txt'])).toBe(true);
      expect(hasFileTools(['excel'])).toBe(true);
    });

    it('returns false when no document tools are present', () => {
      expect(hasFileTools(['web', 'rag_search'])).toBe(false);
      expect(hasFileTools([])).toBe(false);
      expect(hasFileTools(['customer_read', 'product_read'])).toBe(false);
    });
  });
});
