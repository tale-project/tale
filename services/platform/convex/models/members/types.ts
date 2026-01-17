/**
 * Type definitions for Better Auth adapter responses
 *
 * These types match the structure returned by Better Auth's Convex adapter.
 * The adapter queries return records with `_id` as a string identifier.
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
 * Better Auth Organization record from the adapter
 */
export interface BetterAuthOrganization {
  _id: string;
  name: string;
  slug: string;
  logo?: string | null;
  createdAt: number;
  metadata?: string | null;
}

/**
 * Better Auth Session record from the adapter
 */
export interface BetterAuthSession {
  _id: string;
  userId: string;
  token: string;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Better Auth adapter findMany result
 */
export interface BetterAuthFindManyResult<T> {
  page: T[];
  continueCursor?: string;
  isDone?: boolean;
}

/**
 * Better Auth adapter create result
 */
export interface BetterAuthCreateResult {
  _id: string;
  id?: string;
}
