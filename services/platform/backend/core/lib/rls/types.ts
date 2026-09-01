/**
 * Shared types and interfaces for RLS (Row Level Security)
 * Updated to use Better Auth's organization system with string IDs
 */

/**
 * Authenticated user information
 */
export interface AuthenticatedUser {
  userId: string;
  email?: string;
  name?: string;
}

/**
 * Organization member information from Better Auth
 */
export interface OrganizationMember {
  _id: string; // Better Auth member ID
  createdAt: number;
  organizationId: string; // Better Auth organization ID
  userId: string; // Better Auth user ID
  role: string; // Better Auth role (owner, admin, member, etc.)
}

/**
 * RLS context with user, member, and organization information
 */
export interface RLSContext {
  user: AuthenticatedUser;
  member: OrganizationMember;
  organizationId: string; // Better Auth organization ID
  role: string; // Better Auth role
  isAdmin: boolean;
}

/**
 * RLS rule context for convex-helpers RLS
 */
export interface RLSRuleContext {
  user: AuthenticatedUser | null;
  member?: OrganizationMember;
  userOrganizations?: Array<{
    organizationId: string; // Better Auth organization ID
    role: string;
  }>;
}
