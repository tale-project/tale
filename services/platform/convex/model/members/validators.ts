/**
 * Convex validators for members model
 * Re-exports shared Zod schemas and generates Convex validators from them
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
	memberListItemSchema,
	memberSchema,
	memberContextSchema,
	addMemberResponseSchema,
} from '../../../lib/shared/validators/members';

export * from '../common/validators';
export * from '../../../lib/shared/validators/members';

export const memberListItemValidator = zodToConvex(memberListItemSchema);
export const memberValidator = zodToConvex(memberSchema);
export const memberContextValidator = zodToConvex(memberContextSchema);
export const addMemberResponseValidator = zodToConvex(addMemberResponseSchema);
