import { zodToConvex } from 'convex-helpers/server/zod3';
import { oauthAccountSchema } from '../../../lib/shared/validators/accounts';

export * from '../../../lib/shared/validators/accounts';

export const oauthAccountValidator = zodToConvex(oauthAccountSchema);

