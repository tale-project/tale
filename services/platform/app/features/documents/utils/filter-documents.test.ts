import { describe, expect, it } from 'vitest';

import type { DocumentItem, RagStatus } from '@/types/documents';

import {
  filterDocumentResults,
  MY_TEAMS_AUDIENCE,
  ORG_WIDE_AUDIENCE,
} from './filter-documents';

const defaultOptions = {
  selectedTeamIds: [] as string[],
  selectedRagStatuses: [] as string[],
  selectedSources: [] as string[],
  searchQuery: '',
  ragStatusFilterMap: {
    indexed: ['completed'] as RagStatus[],
    not_indexed: ['not_indexed'] as RagStatus[],
  },
};

function makeFolder(
  id: string,
  name: string,
  teamIds: string[] = [],
): DocumentItem {
  return { id, name, type: 'folder', folderId: id, teamIds };
}

function makeDoc(
  id: string,
  name: string,
  teamIds: string[] = [],
  extra: Partial<DocumentItem> = {},
): DocumentItem {
  return { id, name, type: 'file', teamIds, ...extra };
}

describe('filterDocumentResults', () => {
  const hrFolder = makeFolder('f1', 'HR Docs', ['team-hr']);
  const devFolder = makeFolder('f2', 'Dev Docs', ['team-dev']);
  const orgFolder = makeFolder('f3', 'Shared', []);

  const hrDoc = makeDoc('d1', 'Policy.pdf', ['team-hr'], {
    ragStatus: 'completed',
    sourceProvider: 'upload',
  });
  const devDoc = makeDoc('d2', 'README.md', ['team-dev'], {
    ragStatus: 'not_indexed',
    sourceProvider: 'upload',
  });
  const orgDoc = makeDoc('d3', 'Guide.pdf', [], {
    ragStatus: 'completed',
    sourceProvider: 'onedrive',
  });

  const folders = [hrFolder, devFolder, orgFolder];
  const documents = [hrDoc, devDoc, orgDoc];

  it('returns all folders and documents with no filters', () => {
    const result = filterDocumentResults(documents, folders, defaultOptions);
    expect(result).toEqual([...folders, ...documents]);
  });

  describe('selectedTeamIds (filter dropdown)', () => {
    it('filters folders by selectedTeamIds', () => {
      const result = filterDocumentResults(documents, folders, {
        ...defaultOptions,
        selectedTeamIds: ['team-dev'],
      });
      const folderResults = result.filter((r) => r.type === 'folder');
      expect(folderResults).toEqual([devFolder]);
    });

    it('filters documents by selectedTeamIds', () => {
      const result = filterDocumentResults(documents, folders, {
        ...defaultOptions,
        selectedTeamIds: ['team-dev'],
      });
      const docResults = result.filter((r) => r.type === 'file');
      expect(docResults).toEqual([devDoc]);
    });

    it('excludes org-wide items when using selectedTeamIds', () => {
      const result = filterDocumentResults(documents, folders, {
        ...defaultOptions,
        selectedTeamIds: ['team-hr'],
      });
      expect(result).not.toContainEqual(orgFolder);
      expect(result).not.toContainEqual(orgDoc);
    });
  });

  describe('audience tokens', () => {
    it('shows only organization-wide rows for the Organization-wide token', () => {
      const result = filterDocumentResults(documents, folders, {
        ...defaultOptions,
        selectedTeamIds: [ORG_WIDE_AUDIENCE],
      });
      expect(result).toEqual([orgFolder, orgDoc]);
    });

    it('expands the My teams token to the viewer’s own teams', () => {
      const result = filterDocumentResults(documents, folders, {
        ...defaultOptions,
        selectedTeamIds: [MY_TEAMS_AUDIENCE],
        myTeamIds: ['team-hr'],
      });
      expect(result).toEqual([hrFolder, hrDoc]);
    });

    it('matches nothing team-scoped for My teams when the viewer is in no team', () => {
      const result = filterDocumentResults(documents, folders, {
        ...defaultOptions,
        selectedTeamIds: [MY_TEAMS_AUDIENCE],
        myTeamIds: [],
      });
      expect(result).toEqual([]);
    });

    it('combines tokens and team ids as ANY of the selected values', () => {
      const result = filterDocumentResults(documents, folders, {
        ...defaultOptions,
        selectedTeamIds: [ORG_WIDE_AUDIENCE, 'team-dev'],
      });
      expect(result).toEqual([devFolder, orgFolder, devDoc, orgDoc]);
    });
  });

  describe('ragStatus filter (documents only)', () => {
    it('does not filter folders by ragStatus', () => {
      const result = filterDocumentResults(documents, folders, {
        ...defaultOptions,
        selectedRagStatuses: ['indexed'],
      });
      const folderResults = result.filter((r) => r.type === 'folder');
      expect(folderResults).toEqual(folders);
    });

    it('filters documents by ragStatus', () => {
      const result = filterDocumentResults(documents, folders, {
        ...defaultOptions,
        selectedRagStatuses: ['indexed'],
      });
      const docResults = result.filter((r) => r.type === 'file');
      expect(docResults).toEqual([hrDoc, orgDoc]);
    });
  });

  describe('source filter (documents only)', () => {
    it('does not filter folders by source', () => {
      const result = filterDocumentResults(documents, folders, {
        ...defaultOptions,
        selectedSources: ['onedrive'],
      });
      const folderResults = result.filter((r) => r.type === 'folder');
      expect(folderResults).toEqual(folders);
    });

    it('filters documents by source', () => {
      const result = filterDocumentResults(documents, folders, {
        ...defaultOptions,
        selectedSources: ['onedrive'],
      });
      const docResults = result.filter((r) => r.type === 'file');
      expect(docResults).toEqual([orgDoc]);
    });
  });

  describe('text search', () => {
    it('filters both folders and documents by name', () => {
      const result = filterDocumentResults(documents, folders, {
        ...defaultOptions,
        searchQuery: 'guide',
      });
      expect(result).toEqual([orgDoc]);
    });

    it('combines team filter with text search for folders', () => {
      const result = filterDocumentResults(documents, folders, {
        ...defaultOptions,
        selectedTeamIds: ['team-hr'],
        searchQuery: 'Docs',
      });
      const folderResults = result.filter((r) => r.type === 'folder');
      expect(folderResults).toEqual([hrFolder]);
      expect(folderResults).not.toContainEqual(devFolder);
    });
  });
});
