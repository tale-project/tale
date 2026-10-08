/**
 * What the organization has of what an automation document names — the
 * facts behind the validator's org-state warnings (`StoreAdapter.orgFacts`,
 * `lib/engine/core/analysis/org-state.ts`). Each fact is read the way the
 * run that uses it resolves it, so a warning names what a run would miss:
 *
 * - skills: what a run of the automation can stage — the organization's
 *   skills, plus the team skills of every project it is installed in;
 * - connectors: the shipped catalog, the ones holding an active credential,
 *   and the ones that need a credential at all (a platform capability
 *   never does);
 * - secrets: the names of the organization's agent secrets, only for a
 *   caller the secrets listing shows them to (owner, admin, developer) —
 *   anyone else's validation cannot tell, so it cannot probe for a name;
 * - agent runtimes: the harnesses the runtime itself accepts for an
 *   automation step;
 * - the event the automation's enabled event trigger waits for.
 *
 * Only the facts asked for are read, every read in this organization alone,
 * and a read that fails leaves its fact out ("cannot tell") instead of
 * failing the validation.
 */

import type { Sql } from 'postgres';

import { loadConnectorDefinitions } from '../../../lib/connectors/catalog.ts';
import type {
  OrgFacts,
  OrgFactsQuery,
} from '../../../lib/engine/core/slots.ts';
import { EMITTED_EVENT_TYPES } from '../../../lib/shared/event-types.ts';
import { isAdminOrDeveloperRole } from '../../auth/membership.ts';
import { isManagedHarness } from '../../core/chat/external_turn_shared.ts';
import { loadHarnesses } from '../../core/lib/providers/load_system_config.ts';
import { listSkillsForViewer } from '../../core/skills/file_actions.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { listAgentSecrets } from '../agent_secrets/service.ts';
import { listProjectSkillSlugs } from '../chat/composer.ts';
import { listConnectedConnectorSlugs } from '../connector_credentials/service.ts';
import { bindingProjectIds, listTriggers } from './store.ts';

/** Who is validating: their role, and — when reads answer only what the
 * app would show them — the projects they can read. */
export interface OrgFactsViewer {
  role: string;
  /** Null when every installation counts (the app's own editor, whose
   * author gate already passed). */
  readable: ReadonlySet<string> | null;
}

/** A fact's read, or undefined ("cannot tell") when it failed. */
async function settled<T>(
  what: string,
  read: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    console.warn(
      `[automations] ${what} could not be read for validation; cannot tell:`,
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}

/** Every skill a run of `automation` can stage. */
async function reachableSkills(
  sql: Sql,
  organizationId: string,
  automation: string | undefined,
  viewer: () => Promise<OrgFactsViewer>,
): Promise<ReadonlySet<string> | undefined> {
  const orgSlug = await resolveOrgSlug(sql, organizationId);
  if (orgSlug === null) return undefined;
  const installed =
    automation === undefined
      ? []
      : await bindingProjectIds(sql, organizationId, automation);
  const { readable } = await viewer();
  // Installations the caller cannot read add nothing: their team skills
  // would otherwise come back as suggestions.
  const projects =
    readable === null ? installed : installed.filter((id) => readable.has(id));
  const [org, ...perProject] = await Promise.all([
    listSkillsForViewer({ orgSlug, viewer: { kind: 'org' } }),
    ...projects.map((projectId) =>
      listProjectSkillSlugs(sql, { organizationId, projectId }),
    ),
  ]);
  return new Set([
    ...org.skills.map((skill) => skill.slug),
    ...perProject.flat(),
  ]);
}

async function connectorFacts(
  sql: Sql,
  organizationId: string,
): Promise<OrgFacts['connectors']> {
  const catalog = loadConnectorDefinitions();
  return {
    catalogued: new Set(catalog.map((connector) => connector.name)),
    connected: new Set(await listConnectedConnectorSlugs(sql, organizationId)),
    needsCredential: new Set(
      catalog
        .filter(
          (connector) =>
            !connector.auth.some((method) => method.method === 'platform'),
        )
        .map((connector) => connector.name),
    ),
  };
}

async function boundEvent(
  sql: Sql,
  organizationId: string,
  automation: string,
): Promise<OrgFacts['boundEvent']> {
  const trigger = (await listTriggers(sql, organizationId, automation)).find(
    (row) => row.enabled && row.kind === 'event',
  );
  if (trigger === undefined || trigger.event === null) return null;
  return { event: trigger.event, raised: EMITTED_EVENT_TYPES };
}

/** The facts `query` asks for, read for one organization. */
export async function readOrgFacts(
  sql: Sql,
  organizationId: string,
  query: OrgFactsQuery,
  viewer: () => Promise<OrgFactsViewer>,
): Promise<OrgFacts> {
  const { automation } = query;
  const [skills, connectors, secrets, events] = await Promise.all([
    query.skills
      ? settled('the skills', () =>
          reachableSkills(sql, organizationId, automation, viewer),
        )
      : undefined,
    query.connectors
      ? settled('the connectors', () => connectorFacts(sql, organizationId))
      : undefined,
    query.secrets
      ? settled('the agent secrets', async () =>
          isAdminOrDeveloperRole((await viewer()).role)
            ? new Set(
                (await listAgentSecrets(sql, organizationId)).map(
                  (secret) => secret.name,
                ),
              )
            : undefined,
        )
      : undefined,
    query.event && automation !== undefined
      ? settled('the trigger', () =>
          boundEvent(sql, organizationId, automation),
        )
      : undefined,
  ]);
  return {
    ...(skills !== undefined && { skills }),
    ...(connectors !== undefined && { connectors }),
    ...(secrets !== undefined && { secrets }),
    ...(query.harnesses && {
      harnesses: new Set(
        loadHarnesses()
          .map((harness) => harness.slug)
          .filter((slug) => isManagedHarness(slug)),
      ),
    }),
    ...(events !== undefined && { boundEvent: events }),
  };
}
