/**
 * Usage adapter — wraps the existing `defineMessagesUsageTests` so it
 * participates in the new registry. Same shape as the parity adapter.
 */

import { defineMessagesUsageTests } from '../usage';
import { createCheck } from './types';

export const usage = createCheck({
  id: 'usage',
  scope: 'json',
  defaultMode: 'enforce',
  run(ctx) {
    if (!ctx.serviceRoot) return [];
    defineMessagesUsageTests({
      serviceRoot: ctx.serviceRoot,
      messagesDir: ctx.messagesDir,
      scanRoots: ctx.scanRoots ? [...ctx.scanRoots] : undefined,
      allowlistPath: ctx.allowlistPath,
      allowlistDisplayPath: ctx.allowlistDisplayPath,
    });
    return [];
  },
});
