/**
 * Row Level Security (RLS) Library
 *
 * This library provides centralized organization-based access control
 * ensuring users can only access data from their organizations.
 *
 * Main exports for convenience - you can also import directly from specific files.
 */

// Types and interfaces
export type {
  AuthenticatedUser,
  OrganizationMember,
  RLSContext,
  RLSRuleContext,
} from './types';

// Error classes
export {
  RLSError,
  UnauthorizedError,
  UnauthenticatedError,
  OrganizationMismatchError,
} from './errors';

// Validators
export { organizationIdArg, rlsValidators } from './validators';

// Auth functions
export { requireAuthenticatedUser } from './auth/require_authenticated_user';
export { getAuthenticatedUser } from './auth/get_authenticated_user';

// Organization functions
export { getOrganizationMember } from './organization/get_organization_member';
export { getUserOrganizations } from './organization/get_user_organizations';
export { validateOrganizationAccess } from './organization/validate_organization_access';
export { validateResourceOrganization } from './organization/validate_resource_organization';

// Context functions
export { createRLSContext } from './context/create_rls_context';
export {
  createOrgQueryBuilder,
  OrganizationQueryBuilder,
} from './context/create_org_query_builder';

// Wrapper functions
export { withOrganizationRLS } from './wrappers/with_organization_rls';
export { withResourceRLS } from './wrappers/with_resource_rls';

// Helper functions (convex-helpers RLS)
export { queryWithRLS } from './helpers/query_with_rls';
export { mutationWithRLS } from './helpers/mutation_with_rls';
export { rlsRules } from './helpers/rls_rules';

