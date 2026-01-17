/**
 * Type definitions for organizations
 */

import type { Infer } from 'convex/values';
import { memberRoleValidator } from './validators';

// =============================================================================
// INFERRED TYPES (from validators)
// =============================================================================

export type MemberRole = Infer<typeof memberRoleValidator>;
