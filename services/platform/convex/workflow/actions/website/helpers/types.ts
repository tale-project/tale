import type { Id } from '../../../../_generated/dataModel';

// Discriminated union type for website operations
export type WebsiteActionParams =
  | {
      operation: 'create';
      domain: string;
      title?: string;
      description?: string;
      scanInterval?: string;
      lastScannedAt?: number;
      status?: 'active' | 'inactive' | 'error';
      metadata?: Record<string, unknown>;
    }
  | {
      operation: 'update';
      websiteId: Id<'websites'>;
      domain?: string;
      title?: string;
      description?: string;
      scanInterval?: string;
      lastScannedAt?: number;
      status?: 'active' | 'inactive' | 'error';
      metadata?: Record<string, unknown>;
    }
  | {
      operation: 'get_by_domain';
      domain: string;
    };

