/**
 * Record shapes for the Better Auth `user` and `member` rows as the SCIM
 * data layer and the normalized-email lookup read them. The `_id` field is
 * the 0.4 adapter's identifier name, kept because those readers still
 * address rows by it.
 */

/**
 * Better Auth User record from the adapter
 */
export interface BetterAuthUser {
  _id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: number;
  updatedAt: number;
  userId?: string | null;
  twoFactorEnabled?: boolean | null;
  twoFactorGraceUntil?: number | null;
  lastActiveOrganizationId?: string | null;
}

/**
 * Better Auth Member record from the adapter
 */
export interface BetterAuthMember {
  _id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: number;
}

/**
 * Better Auth adapter findMany result
 */
export interface BetterAuthFindManyResult<T> {
  page: T[];
  continueCursor?: string;
  isDone?: boolean;
}
