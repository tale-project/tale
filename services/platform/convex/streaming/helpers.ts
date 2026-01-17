/**
 * Streaming domain helpers
 *
 * Provides the PersistentTextStreaming instance for use in mutations and actions.
 */

import { PersistentTextStreaming } from '@convex-dev/persistent-text-streaming';
import { components } from '../_generated/api';

export const persistentStreaming = new PersistentTextStreaming(
  components.persistentTextStreaming
);
