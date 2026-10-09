import { describe, expect, it } from 'vitest';

import { redactSensitiveFields } from '../../../lib/shared/audit-redaction.ts';
import { attributeApiKeyAudit, withApiKeyAuditActor } from './request-actor.ts';
import type { CreateAuditLogArgs } from './types.ts';

const event: CreateAuditLogArgs = {
  organizationId: 'org-1',
  actorId: 'member-1',
  actorEmail: 'member@example.com',
  actorEmailHash: 'subject-email-hash',
  actorRole: 'member',
  actorType: 'user',
  action: 'skill.updated',
  category: 'skill',
  resourceType: 'skill',
  status: 'success',
};
const identity = {
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  makerUserId: 'admin-1',
  subjectUserId: 'member-1',
};

describe('request audit attribution [AUDIT-R7]', () => {
  it('does not stamp a different organization’s background row', async () => {
    await withApiKeyAuditActor(identity, async () => {
      const other = { ...event, organizationId: 'org-2' };
      expect(attributeApiKeyAudit(other)).toBe(other);
    });
  });

  it('keeps concurrent key identities isolated across awaits', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withApiKeyAuditActor(identity, async () => {
      await gate;
      return attributeApiKeyAudit(event);
    });
    const second = withApiKeyAuditActor(
      { ...identity, apiKeyId: 'key-2', makerUserId: 'admin-2' },
      async () => {
        await Promise.resolve();
        const result = attributeApiKeyAudit(event);
        release();
        return result;
      },
    );
    const [a, b] = await Promise.all([first, second]);
    expect(a.actorId).toBe('admin-1');
    expect(redactSensitiveFields(a.metadata)?.keyAttribution).toEqual({
      makerUserId: 'admin-1',
      subjectUserId: 'member-1',
      eventActorId: 'member-1',
    });
    expect(a.metadata?.apiKeyId).toBe('key-1');
    expect(b.actorId).toBe('admin-2');
    expect(b.metadata?.apiKeyId).toBe('key-2');
    expect(a.actorEmail).toBeUndefined();
    expect(a.actorEmailHash).toBeUndefined();
    expect(a.actorRole).toBeUndefined();
    expect(attributeApiKeyAudit(event)).toBe(event);
  });

  it.each([false, true])(
    'expires inherited callbacks after completion (throws=%s)',
    async (throws) => {
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let later: Promise<CreateAuditLogArgs> | undefined;
      const request = withApiKeyAuditActor(identity, async () => {
        later = gate.then(() => attributeApiKeyAudit(event));
        expect(attributeApiKeyAudit(event).actorId).toBe('admin-1');
        if (throws) throw new Error('request failed');
      });
      if (throws) await expect(request).rejects.toThrow('request failed');
      else await request;
      release();
      expect(await later).toBe(event);
    },
  );
});
