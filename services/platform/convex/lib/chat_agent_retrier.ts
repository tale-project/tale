/**
 * Shared ActionRetrier instance for chat agent operations.
 *
 * Keeping this in lib/ allows multiple Convex functions and model helpers
 * to reuse the same configuration without re‑instantiating it.
 */

import { ActionRetrier } from '@convex-dev/action-retrier';
import { components } from '../_generated/api';

export const chatAgentRetrier = new ActionRetrier(components.actionRetrier, {
  initialBackoffMs: 1000,
  base: 1.4,
  maxFailures: 3,
});

