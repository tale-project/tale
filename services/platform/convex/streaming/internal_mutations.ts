import { v } from 'convex/values';

import { components } from '../_generated/api';
import { internalMutation } from '../_generated/server';

export const updateStreamStatus = internalMutation({
  args: {
    streamId: v.string(),
    status: v.union(
      v.literal('streaming'),
      v.literal('done'),
      v.literal('error'),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(
      components.persistentTextStreaming.lib.setStreamStatus,
      {
        streamId: args.streamId,
        status: args.status,
      },
    );
  },
});

export const startStream = internalMutation({
  args: {
    streamId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(
      components.persistentTextStreaming.lib.setStreamStatus,
      {
        streamId: args.streamId,
        status: 'streaming',
      },
    );
  },
});

export const appendToStream = internalMutation({
  args: {
    streamId: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(components.persistentTextStreaming.lib.addChunk, {
      streamId: args.streamId,
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
    await ctx.runMutation(
      components.persistentTextStreaming.lib.setStreamStatus,
      {
        streamId: args.streamId,
        status: 'done',
      },
    );
  },
});

export const errorStream = internalMutation({
  args: {
    streamId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(
      components.persistentTextStreaming.lib.setStreamStatus,
      {
        streamId: args.streamId,
        status: 'error',
      },
    );
  },
});
