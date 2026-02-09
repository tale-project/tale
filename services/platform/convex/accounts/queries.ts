import { v } from 'convex/values';

import { query } from '../_generated/server';
import {
  hasCredentialAccount as hasCredentialAccountHelper,
  hasMicrosoftAccount as hasMicrosoftAccountHelper,
} from './helpers';

export const hasCredentialAccount = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    return await hasCredentialAccountHelper(ctx);
  },
});

export const hasMicrosoftAccount = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    return await hasMicrosoftAccountHelper(ctx);
  },
});
