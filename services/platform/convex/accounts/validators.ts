/**
 * Convex validators for accounts domain
 *
 * Accounts use Better Auth for storage - no schema table.
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import { oauthAccountSchema } from '../../lib/shared/schemas/accounts';

export const oauthAccountValidator = zodToConvex(oauthAccountSchema);
