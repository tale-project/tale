/**
 * Streaming Mutations
 *
 * Internal mutations for managing persistent text streams.
 * Uses the Persistent Text Streaming component's lib functions directly.
 */

import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { components } from '../_generated/api';

export const updateStreamStatus = internalMutation({
  args: {
    streamId: v.string(),
    status: v.union(v.literal('streaming'), v.literal('done'), v.literal('error')),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(components.persistentTextStreaming.lib.setStreamStatus, {
      streamId: args.streamId as any,
      status: args.status,
    });
  },
});

export const startStream = internalMutation({
  args: {
    streamId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(components.persistentTextStreaming.lib.setStreamStatus, {
      streamId: args.streamId as any,
      status: 'streaming',
    });
  },
});

export const appendToStream = internalMutation({
  args: {
    streamId: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(components.persistentTextStreaming.lib.addChunk, {
      streamId: args.streamId as any,
      text: args.text,
      final: false,
    });
  },
});

export const completeStream = internalMutation({
  args: {
    streamId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(components.persistentTextStreaming.lib.setStreamStatus, {
      streamId: args.streamId as any,
      status: 'done',
    });
  },
});

export const errorStream = internalMutation({
  args: {
    streamId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(components.persistentTextStreaming.lib.setStreamStatus, {
      streamId: args.streamId as any,
      status: 'error',
    });
  },
});
