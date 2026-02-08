import type { Id } from '../../../../_generated/dataModel';
import type { ConvexJsonRecord } from '../../../../../lib/shared/schemas/utils/json-value';

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
      metadata?: ConvexJsonRecord;
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
      metadata?: ConvexJsonRecord;
    }
  | {
      operation: 'get_by_domain';
      domain: string;
    };

