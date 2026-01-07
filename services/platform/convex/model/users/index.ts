/**
 * Central export point for users model
 */

import { v } from 'convex/values';

/**
 * Role validator for user roles in organizations
 */
export const roleValidator = v.string();

/**
 * Type for user roles
 */
export type Role = 'admin' | 'member' | (string & {});

export * from './get_user_by_email';
export * from './add_member_internal';
export * from './create_user_without_session';
export * from './create_member';
export * from './update_user_password';
export * from './has_any_users';
