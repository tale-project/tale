import type { MutationCtx, ActionCtx } from '../../_generated/server';
import type { EventType } from './event_types';

import { internal } from '../../_generated/api';

interface EmitEventArgs {
  organizationId: string;
  eventType: EventType;
  eventData?: Record<string, unknown>;
}

export async function emitEvent(ctx: MutationCtx, args: EmitEventArgs) {
  await ctx.scheduler.runAfter(
    0,
    internal.workflows.triggers.internal_mutations.processEvent,
    {
      organizationId: args.organizationId,
      eventType: args.eventType,
      eventData: args.eventData,
    },
  );
}

export async function emitEventFromAction(ctx: ActionCtx, args: EmitEventArgs) {
  await ctx.scheduler.runAfter(
    0,
    internal.workflows.triggers.internal_mutations.processEvent,
    {
      organizationId: args.organizationId,
      eventType: args.eventType,
      eventData: args.eventData,
    },
  );
}
