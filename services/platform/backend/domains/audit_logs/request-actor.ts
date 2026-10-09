import { AsyncLocalStorage } from 'node:async_hooks';

import type { CreateAuditLogArgs } from './types.ts';

/** Verified door identity, separate from the subject's authorization. */
interface ApiKeyAuditActor {
  organizationId: string;
  apiKeyId: string;
  makerUserId: string;
  subjectUserId: string;
}

const requestActor = new AsyncLocalStorage<{
  identity: ApiKeyAuditActor;
  active: boolean;
}>();

/** Only awaited work in this request inherits its key attribution. A child
 * callback that outlives the response must not relabel a later job. */
export async function withApiKeyAuditActor<T>(
  identity: ApiKeyAuditActor,
  work: () => Promise<T>,
): Promise<T> {
  const scope = { identity: { ...identity }, active: true };
  return requestActor.run(scope, async () => {
    try {
      return await work();
    } finally {
      scope.active = false;
    }
  });
}

/** Applied before normalization/hashing by the one persisted-row writer.
 * Domain metadata survives; verified attribution wins over supplied values.
 * The maker's address/role is not inferred from the member's credentials. */
export function attributeApiKeyAudit(
  args: CreateAuditLogArgs,
): CreateAuditLogArgs {
  const scope = requestActor.getStore();
  if (!scope?.active || scope.identity.organizationId !== args.organizationId) {
    return args;
  }
  const { identity } = scope;
  const {
    actorEmail: _email,
    actorEmailHash: _emailHash,
    actorRole: _role,
    ...event
  } = args;
  return {
    ...event,
    actorId: identity.makerUserId,
    actorType: 'api',
    metadata: {
      ...args.metadata,
      apiKeyId: identity.apiKeyId,
      keyAttribution: {
        makerUserId: identity.makerUserId,
        subjectUserId: identity.subjectUserId,
        // Explicitly relayed actors remain subjects too; system labels
        // carry no person to erase but can still describe the event.
        eventActorId: args.actorId,
      },
    },
  };
}
