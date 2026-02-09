import type { MutationCtx, ActionCtx } from '../../_generated/server';
import type { EventType } from './event_types';

import { internal } from '../../_generated/api';

interface EmitEventArgs {
  organizationId: string;
  eventType: EventType;
  eventData?: Record<string, unknown>;
}

export async function emitEvent(ctx: MutationCtx, args: EmitEventArgs) {
  const processEventArgs = {
    organizationId: args.organizationId,
    eventType: args.eventType as string,
    eventData: args.eventData,
  };
  await ctx.scheduler.runAfter(
    0,
    internal.workflows.triggers.internal_mutations.processEvent,
    // @ts-expect-error - FilterApi can't resolve deeply nested internal paths
    processEventArgs,
  );
}

export async function emitEventFromAction(ctx: ActionCtx, args: EmitEventArgs) {
  const processEventArgs = {
    organizationId: args.organizationId,
    eventType: args.eventType as string,
    eventData: args.eventData,
  };
  await ctx.scheduler.runAfter(
    0,
    internal.workflows.triggers.internal_mutations.processEvent,
    // @ts-expect-error - FilterApi can't resolve deeply nested internal paths
    processEventArgs,
  );
}
