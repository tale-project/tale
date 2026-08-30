export const AUDIT_LOG_ACTOR_TYPES = [
  'user',
  'system',
  'api',
  'workflow',
] as const;
export const AUDIT_LOG_CATEGORIES = [
  'auth',
  'member',
  'data',
  'connector',
  // Legacy spelling of `connector` from before the integration→connector
  // rename (#2876). 0.4 deploys never write it; accepted so pre-rename LOCAL
  // dev rows keep validating (audit rows are immutable history — a hash
  // chain — so they are read as-is rather than rewritten).
  'integration',
  'workflow',
  'security',
  'admin',
  'ai',
  'skill',
  'agent',
] as const;
export const AUDIT_LOG_STATUSES = ['success', 'failure', 'denied'] as const;
