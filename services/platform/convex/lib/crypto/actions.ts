/**
 * Crypto Actions
 *
 * Internal actions for encryption/decryption operations.
 */

import { v } from 'convex/values';
import { internalAction } from '../../_generated/server';
import { encryptString } from './encrypt_string';
import { decryptString } from './decrypt_string';

/**
 * Encrypt a string (internal action)
 */
export const encryptStringInternal = internalAction({
  args: {
    plaintext: v.string(),
  },
  returns: v.string(),
  handler: async (_ctx, args) => {
    return await encryptString(args.plaintext);
  },
});

/**
 * Decrypt a string (internal action)
 */
export const decryptStringInternal = internalAction({
  args: {
    jwe: v.string(),
  },
  returns: v.string(),
  handler: async (_ctx, args) => {
    return await decryptString(args.jwe);
  },
});
