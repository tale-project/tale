import type { Sql } from 'postgres';

import { collectComposerOptions } from '../../core/chat/composer.ts';
import { listConnectorSummaries } from '../../core/connector_credentials/connector_catalog.ts';
import { walkChatCatalog } from '../../core/lib/providers/chat_catalog.ts';
import {
  loadHarnesses,
  readSystemEntryIcon,
} from '../../core/lib/providers/load_system_config.ts';
import { listSkillsForViewer } from '../../core/skills/file_actions.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { listConnectedConnectorSlugs } from '../connector_credentials/service.ts';
import { getAccessibleModelsForUser } from '../governance/service.ts';
import { listServingCredentialFacts } from '../provider_credentials/service.ts';
import { chatShimHandlers } from './shim.ts';
import { projectChatAccess, ChatThreadError } from './threads.ts';

/**
 * The composer surface — the 0.5 twin of `convex/chat/composer.ts`: the
 * model picker's listing (the SAME connector walk a turn resolves, per-hit
 * projection REUSED via `collectComposerOptions`, governance-filtered
 * server-side so the picker never even sees a hidden model) plus the
 * capability menus (skills through the reused file-layer viewer; connectors
 * from the org's connected set — the slugs holding an active credential,
 * labelled from the shipped catalog).
 */

export interface ComposerCapability {
  slug: string;
  label: string;
  description?: string;
  icon?: string;
}

function toSkillCapability(skill: {
  slug: string;
  description: string;
  icon?: string;
}): ComposerCapability {
  const option: ComposerCapability = { slug: skill.slug, label: skill.slug };
  if (skill.description !== '') option.description = skill.description;
  if (skill.icon !== undefined) option.icon = skill.icon;
  return option;
}

/** The connectors an agent can be equipped with: the org's CONNECTED set —
 * every shipped connector holding at least one active credential — labelled
 * from the catalog. The grant vocabulary is the connector slug; the run
 * resolves the pair's default credential at dispatch, so one listing serves
 * the project-agent and automation pickers alike. */
async function listConnectorCapabilities(
  sql: Sql,
  organizationId: string,
): Promise<ComposerCapability[]> {
  const connected = new Set(
    await listConnectedConnectorSlugs(sql, organizationId),
  );
  if (connected.size === 0) return [];
  return listConnectorSummaries()
    .filter((summary) => connected.has(summary.slug))
    .map((summary) => {
      const option: ComposerCapability = {
        slug: summary.slug,
        label: summary.displayName,
      };
      if (summary.description !== '') option.description = summary.description;
      if (summary.iconUrl !== undefined) option.icon = summary.iconUrl;
      return option;
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function listComposerModels(
  sql: Sql,
  args: { organizationId: string; userId: string },
): Promise<{
  models: unknown[];
  harnesses: Array<{ harness: string; label: string; iconUrl?: string }>;
  voice: { ttsAvailable: boolean; transcriptionAvailable: boolean };
}> {
  // The SERVABLE set: each provider's active default credential — the row
  // every serving path resolves — never every active row, or the picker
  // offers models no turn can run the moment a default is disabled.
  const directFirst = (method: string): number =>
    method === 'api-key' || method === 'env' ? 0 : 1;
  const servable = (
    await listServingCredentialFacts(sql, args.organizationId)
  ).sort((a, b) => directFirst(a.authMethod) - directFirst(b.authMethod));

  const shim = createCtxShim(chatShimHandlers(sql));
  const hits = await walkChatCatalog(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reused 0.4 walk; its only ctx facility (the org-slug read) is covered by chatShimHandlers
    shim as unknown as Parameters<typeof walkChatCatalog>[0],
    args.organizationId,
    servable,
  );
  const { byId, ttsAvailable, transcriptionAvailable } =
    collectComposerOptions(hits);

  // The governance model-access policy filters the catalog server-side —
  // the turn re-checks at send time.
  const candidateIds = [
    ...new Set([...byId.values()].map((option) => option.id)),
  ];
  if (candidateIds.length > 0) {
    const accessible = new Set(
      await getAccessibleModelsForUser(sql, {
        organizationId: args.organizationId,
        userId: args.userId,
        modelIds: candidateIds,
      }),
    );
    for (const [key, option] of byId) {
      if (!accessible.has(option.id)) byId.delete(key);
    }
  }
  const models = [...byId.values()].sort(
    (a, b) =>
      a.label.localeCompare(b.label) ||
      a.providerSlug.localeCompare(b.providerSlug),
  );

  // Only harnesses the managed lane can actually run.
  const harnesses = loadHarnesses()
    .filter((harness) => harness.credentialPolicy.managed)
    .map((harness) => {
      const iconUrl = readSystemEntryIcon('harnesses', harness.slug);
      const row: { harness: string; label: string; iconUrl?: string } = {
        harness: harness.slug,
        label: harness.displayName,
      };
      if (iconUrl !== undefined) row.iconUrl = iconUrl;
      return row;
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    models,
    harnesses,
    voice: { ttsAvailable, transcriptionAvailable },
  };
}

/** The project's team scope for skill visibility. */
async function projectTeamIds(sql: Sql, projectId: string): Promise<string[]> {
  const rows = await sql<
    { teamId: string | null; sharedWithTeamIds: string[] }[]
  >`
    SELECT team_id AS "teamId",
           shared_with_team_ids AS "sharedWithTeamIds"
    FROM app.projects WHERE id = ${projectId} LIMIT 1
  `;
  const row = rows[0];
  if (!row) return [];
  return [
    ...new Set([
      ...(row.teamId !== null ? [row.teamId] : []),
      ...row.sharedWithTeamIds,
    ]),
  ];
}

/**
 * What a PROJECT's agents can equip: the skills visible to the project
 * ITSELF (org-wide + its teams') — deliberately not the configuring
 * member's visibility — plus the org's connected connectors.
 */
export async function listProjectCapabilities(
  sql: Sql,
  args: { organizationId: string; userId: string; projectId: string },
): Promise<{ skills: ComposerCapability[]; connectors: ComposerCapability[] }> {
  const access = await projectChatAccess(sql, {
    projectId: args.projectId,
    organizationId: args.organizationId,
    userId: args.userId,
  });
  if (access !== 'ok') {
    throw new ChatThreadError(
      access === 'not_found' ? 'PROJECT_NOT_FOUND' : 'PROJECT_FORBIDDEN',
      'You do not have access to this project.',
      access === 'not_found' ? 404 : 403,
    );
  }
  const orgSlug = await resolveOrgSlug(sql, args.organizationId);
  if (orgSlug === null) return { skills: [], connectors: [] };
  const listing = await listSkillsForViewer({
    orgSlug,
    viewer: {
      kind: 'project',
      teamIds: await projectTeamIds(sql, args.projectId),
    },
  });
  return {
    skills: listing.skills
      .map(toSkillCapability)
      .sort((a, b) => a.label.localeCompare(b.label)),
    connectors: await listConnectorCapabilities(sql, args.organizationId),
  };
}

/**
 * What an AUTOMATION's agent node can equip: org-wide skills, optionally
 * widened to a project's team skills, plus the org's connected connectors.
 * The route gates on the developer role, matching the automation domain's
 * own write gate.
 */
export async function listAutomationCapabilities(
  sql: Sql,
  args: { organizationId: string; projectId?: string },
): Promise<{ skills: ComposerCapability[]; connectors: ComposerCapability[] }> {
  const orgSlug = await resolveOrgSlug(sql, args.organizationId);
  if (orgSlug === null) return { skills: [], connectors: [] };
  const listing = await listSkillsForViewer({
    orgSlug,
    viewer:
      args.projectId !== undefined
        ? {
            kind: 'project',
            teamIds: await projectTeamIds(sql, args.projectId),
          }
        : { kind: 'org' },
  });
  return {
    skills: listing.skills
      .map(toSkillCapability)
      .sort((a, b) => a.label.localeCompare(b.label)),
    connectors: await listConnectorCapabilities(sql, args.organizationId),
  };
}
