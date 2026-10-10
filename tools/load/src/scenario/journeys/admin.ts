/**
 * Administration journeys: the members and teams pages, the audit log
 * (owners and admins), a personal API key created, listed and revoked
 * (owners, admins and developers), and the account settings everyone has.
 * Each is offered only to the roles the SPA offers it to.
 */

import { createApiKey, deleteApiKey, listApiKeys } from '../../api/auth.ts';
import {
  auditLogSummary,
  listAuditLogs,
  listMembers,
  listTeams,
  setCustomInstructions,
  teamDirectory,
  teamMembers,
  updateName,
} from '../../api/workspace.ts';
import { chance, pick } from '../../data/random.ts';
import { customInstructions, displayName } from '../../data/work.ts';
import type { Journey } from './journey.ts';

/** The members page. */
export const members: Journey = {
  name: 'admin.members',
  run: async (vu) => {
    vu.screen = 'other';
    await listMembers(vu.api, vu.orgId);
    await vu.pause('read');
  },
};

/** The teams page and one team's members. */
export const teams: Journey = {
  name: 'admin.teams',
  run: async (vu) => {
    vu.screen = 'other';
    const [listed] = await Promise.all([
      listTeams(vu.api, vu.orgId),
      teamDirectory(vu.api, vu.orgId),
    ]);
    await vu.pause('read');
    const teamId = pick(vu.random, listed.body ?? []);
    if (teamId !== undefined) await teamMembers(vu.api, vu.orgId, teamId);
  },
};

/** The audit log: the latest page and the activity summary. */
export const auditLog: Journey = {
  name: 'admin.audit-log',
  eligible: (vu) => vu.canReadAudit,
  run: async (vu) => {
    vu.screen = 'other';
    await listAuditLogs(vu.api, vu.orgId);
    await vu.pause('read');
    if (chance(vu.random, 0.5)) await auditLogSummary(vu.api, vu.orgId);
  },
};

/** Create a personal API key, see it listed, revoke it again. */
export const apiKeyLifecycle: Journey = {
  name: 'admin.api-keys',
  eligible: (vu) => vu.canCreateApiKeys,
  run: async (vu) => {
    vu.screen = 'other';
    await listApiKeys(vu.api);
    await vu.pause('type', 0.3);
    const created = await createApiKey(
      vu.api,
      `load ${vu.ctx.plan.runId} u${vu.index} ${Math.floor(vu.random() * 1e6)}`,
    );
    if (created.body === undefined) return;
    vu.metrics.counter('apikeys.created');
    await listApiKeys(vu.api);
    await vu.pause('read');
    const revoked = await deleteApiKey(vu.api, created.body.id);
    if (revoked.ok) vu.metrics.counter('apikeys.revoked');
  },
};

/** Account settings: the display name, the assistant's instructions. */
export const updateSettings: Journey = {
  name: 'settings.update',
  run: async (vu) => {
    vu.screen = 'other';
    await vu.pause('type');
    if (chance(vu.random, 0.5)) {
      await updateName(vu.api, displayName(vu.data));
    } else {
      await setCustomInstructions(
        vu.api,
        vu.orgId,
        customInstructions(vu.data, vu.random),
      );
    }
  },
};
