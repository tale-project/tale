export interface WebsiteActionParams {
  operation: 'create' | 'update' | 'get_by_domain';
  websiteId?: string;
  organizationId?: string;
  domain?: string;
  title?: string;
  description?: string;
  scanInterval?: string;
  lastScannedAt?: number;
  status?: 'active' | 'inactive' | 'error';
  metadata?: Record<string, unknown>;
}

