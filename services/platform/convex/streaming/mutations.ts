/**
 * Streaming Mutations
 *
 * Internal mutations for managing persistent text streams.
 */

import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { persistentStreaming } from './helpers';

export const startStream = internalMutation({
  args: {
    streamId: v.string(),
  },
  handler: async (ctx, args) => {
    await persistentStreaming.startStream(ctx, args.streamId as any);
  },
});

export const appendToStream = internalMutation({
  args: {
    streamId: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await persistentStreaming.appendToStream(ctx, args.streamId as any, args.text);
  },
});

export const completeStream = internalMutation({
  args: {
    streamId: v.string(),
  },
  handler: async (ctx, args) => {
    await persistentStreaming.completeStream(ctx, args.streamId as any);
  },
});

export const errorStream = internalMutation({
  args: {
    streamId: v.string(),
  },
  handler: async (ctx, args) => {
    await persistentStreaming.errorStream(ctx, args.streamId as any);
  },
});
