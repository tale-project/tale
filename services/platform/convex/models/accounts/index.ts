import { zodToConvex } from 'convex-helpers/server/zod3';
import { oauthAccountSchema } from '../../../lib/shared/schemas/accounts';

export * from '../../../lib/shared/schemas/accounts';

export const oauthAccountValidator = zodToConvex(oauthAccountSchema);

