/**
 * `websites` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../websites.ts` are what
 * actually serve them.
 */

export interface WebsitesContract {
  'websites/actions:createWebsite': {
    kind: 'action';
    args: {
      title?: string;
      description?: string;
      urls?: string[];
      organizationId: string;
      domain: string;
      scanInterval: string;
    };
    returns: string;
  };
  'websites/actions:deleteWebsite': {
    kind: 'action';
    args: { websiteId: string };
    returns: null;
  };
  'websites/actions:fetchChunks': {
    kind: 'action';
    args: { url: string; websiteId: string };
    returns: {
      url: string;
      chunks: Array<{
        chunk_index: number;
        chunk_content: string;
        core_content?: string;
      }>;
      total: number;
    };
  };
  'websites/actions:fetchPages': {
    kind: 'action';
    args: { limit?: number; offset?: number; websiteId: string };
    returns: {
      pages: Array<{
        url: string;
        title: null | string;
        word_count: number;
        status: string;
        content_hash: null | string;
        last_crawled_at: null | string;
        discovered_at: null | string;
        chunks_count: number;
        indexed: boolean;
      }>;
      total: number;
      offset: number;
      hasMore: boolean;
    };
  };
  'websites/actions:resumeScanning': {
    kind: 'action';
    args: { websiteId: string };
    returns: null;
  };
  'websites/actions:searchContent': {
    kind: 'action';
    args: { limit?: number; query: string; websiteId: string };
    returns: {
      query: string;
      results: Array<{
        url: string;
        title: null | string;
        chunk_content: string;
        chunk_index: number;
        score: number;
        core_content?: string;
      }>;
      total: number;
    };
  };
  'websites/actions:syncStatuses': {
    kind: 'action';
    args: { organizationId: string };
    returns: null;
  };
  'websites/actions:updateWebsite': {
    kind: 'action';
    args: {
      title?: string;
      description?: string;
      scanInterval?: string;
      websiteId: string;
    };
    returns: null;
  };
  'websites/queries:approxCountWebsites': {
    kind: 'query';
    args: { organizationId: string };
    returns: number;
  };
  'websites/queries:listWebsites': {
    kind: 'query';
    args: { organizationId: string };
    returns: Array<{
      _id: string;
      _creationTime: number;
      status?: 'active' | 'error' | 'idle' | 'scanning' | 'deleting';
      metadata?: Record<string, unknown>;
      kind?: 'site' | 'list';
      title?: string;
      description?: string;
      pageCount?: number;
      lastScannedAt?: number;
      crawledPageCount?: number;
      organizationId: string;
      domain: string;
      scanInterval: string;
    }>;
  };
  'websites/queries:listWebsitesPaginated': {
    kind: 'query';
    args: {
      status?: string;
      scanInterval?: string;
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
        _id: string;
        _creationTime: number;
        status?: 'active' | 'error' | 'idle' | 'scanning' | 'deleting';
        metadata?: Record<string, unknown>;
        kind?: 'site' | 'list';
        title?: string;
        description?: string;
        pageCount?: number;
        lastScannedAt?: number;
        crawledPageCount?: number;
        organizationId: string;
        domain: string;
        scanInterval: string;
      }>;
      isDone: boolean;
      continueCursor: string;
      splitCursor?: null | string;
      pageStatus?: null | 'SplitRecommended' | 'SplitRequired';
    };
  };
}
