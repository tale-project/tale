import { v } from 'convex/values';

import { internalAction } from '../../_generated/server';
import { decryptString as decryptStringHelper } from './decrypt_string';
import { encryptString as encryptStringHelper } from './encrypt_string';

export const encryptString = internalAction({
  args: {
    plaintext: v.string(),
  },
  returns: v.string(),
  handler: async (_ctx, args) => {
    return await encryptStringHelper(args.plaintext);
  },
});

export const decryptString = internalAction({
  args: {
    jwe: v.string(),
  },
  returns: v.string(),
  handler: async (_ctx, args) => {
    return await decryptStringHelper(args.jwe);
  },
});
