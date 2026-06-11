import { describe, expect, it } from 'vitest';

import { buildRagSearchFilters } from './rag_metadata_filters';

describe('buildRagSearchFilters', () => {
  it('returns undefined when nothing is set', () => {
    expect(buildRagSearchFilters({})).toBeUndefined();
  });

  it('returns undefined when the folder path normalizes away', () => {
    expect(buildRagSearchFilters({ folderPath: ' /// ' })).toBeUndefined();
  });

  it('returns undefined for an empty metadata map', () => {
    expect(buildRagSearchFilters({ metadata: {} })).toBeUndefined();
  });

  it('maps folderPath to snake_case and normalizes it', () => {
    expect(buildRagSearchFilters({ folderPath: '/contracts/2024/' })).toEqual({
      folder_path: 'contracts/2024',
    });
  });

  it('passes metadata equality and IN filters through', () => {
    expect(
      buildRagSearchFilters({
        metadata: { department: 'legal', year: [2023, 2024] },
      }),
    ).toEqual({ metadata: { department: 'legal', year: [2023, 2024] } });
  });

  it('combines folder path and metadata', () => {
    expect(
      buildRagSearchFilters({
        folderPath: 'data-room',
        metadata: { active: true },
      }),
    ).toEqual({ folder_path: 'data-room', metadata: { active: true } });
  });
});
