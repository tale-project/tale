/**
 * `knowledge_entries` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../knowledge_entries.ts` are what
 * actually serve them.
 */

export interface KnowledgeEntriesContract {
  'knowledge_entries/mutations:createKnowledgeEntry': {
    kind: 'mutation';
    args: { organizationId: string; content: string; topic: string };
    returns: string;
  };
  'knowledge_entries/mutations:deleteKnowledgeEntry': {
    kind: 'mutation';
    args: { entryId: string };
    returns: null;
  };
  'knowledge_entries/mutations:updateKnowledgeEntry': {
    kind: 'mutation';
    args: { content: string; topic: string; entryId: string };
    returns: string;
  };
  'knowledge_entries/queries:approxCountKnowledgeEntries': {
    kind: 'query';
    args: { organizationId: string };
    returns: number;
  };
  'knowledge_entries/queries:getKnowledgeEntryVersions': {
    kind: 'query';
    args: { organizationId: string; entryId: string };
    returns: null | {
      entry: {
        ragStatus?:
          | 'queued'
          | 'running'
          | 'failed'
          | 'completed'
          | 'unsupported'
          | 'not_indexed';
        ragIndexedAt?: number;
        ragError?: string;
        ragErrorCode?: string;
        _id: string;
        _creationTime: number;
        deletedAt?: number;
        sourceThreadId?: string;
        sourceMessageId?: string;
        documentId?: string;
        supersededBy?: string;
        supersededAt?: number;
        status: 'active' | 'superseded';
        organizationId: string;
        createdBy: string;
        createdAt: number;
        content: string;
        source: 'chat' | 'manual';
        topic: string;
        topicKey: string;
      };
      versions: Array<{
        _id: string;
        _creationTime: number;
        deletedAt?: number;
        sourceThreadId?: string;
        sourceMessageId?: string;
        documentId?: string;
        supersededBy?: string;
        supersededAt?: number;
        status: 'active' | 'superseded';
        organizationId: string;
        createdBy: string;
        createdAt: number;
        content: string;
        source: 'chat' | 'manual';
        topic: string;
        topicKey: string;
      }>;
    };
  };
  'knowledge_entries/queries:listKnowledgeEntriesPaginated': {
    kind: 'query';
    args: {
      status?: 'active' | 'superseded';
      organizationId: string;
      paginationOpts: {
        id?: number;
        endCursor?: null | string;
        maximumRowsRead?: number;
        maximumBytesRead?: number;
        numItems: number;
        cursor: null | string;
      };
    };
    returns: {
      page: Array<{
        ragStatus?:
          | 'queued'
          | 'running'
          | 'failed'
          | 'completed'
          | 'unsupported'
          | 'not_indexed';
        ragIndexedAt?: number;
        ragError?: string;
        ragErrorCode?: string;
        _id: string;
        _creationTime: number;
        deletedAt?: number;
        sourceThreadId?: string;
        sourceMessageId?: string;
        documentId?: string;
        supersededBy?: string;
        supersededAt?: number;
        status: 'active' | 'superseded';
        organizationId: string;
        createdBy: string;
        createdAt: number;
        content: string;
        source: 'chat' | 'manual';
        topic: string;
        topicKey: string;
      }>;
      isDone: boolean;
      continueCursor: string;
      splitCursor?: null | string;
      pageStatus?: null | 'SplitRecommended' | 'SplitRequired';
    };
  };
}
