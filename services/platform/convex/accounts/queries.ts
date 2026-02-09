import { v } from 'convex/values';

import { query } from '../_generated/server';
import { hasMicrosoftAccount as hasMicrosoftAccountHelper } from './helpers';

export const hasMicrosoftAccount = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    return await hasMicrosoftAccountHelper(ctx);
  },
});
