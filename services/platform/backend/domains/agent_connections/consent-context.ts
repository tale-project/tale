import type { Sql } from 'postgres';

import {
  type AgentScope,
  isAgentScope,
  MCP_RESOURCE_SCOPES,
  requestsAgentAccess,
  scopeCeilingForRole,
  scopesOf,
} from '../../../lib/shared/agent-access.ts';
import { mayConnectAgentIn } from '../../auth/api-key-create-gate.ts';
import { evaluateTwoFactorEnforcement } from '../two_factor/service.ts';
import {
  type AgentClientIdentity,
  agentClientIdentity,
  readAgentClientRow,
} from './client-identity.ts';

/**
 * What the consent page of a coding agent needs to know before it shows its
 * choices: who the app is, what it asked for, and, for each organization the
 * person belongs to, whether they may connect an agent there and the most
 * their role there lets them allow. The consent gate (`auth/agent-consent.ts`)
 * decides the same things when the person chooses; this tells the page first,
 * so it never offers what the gate would refuse.
 */

/** Why a person may not connect an agent to an organization. */
type ConsentOrganizationRefusal =
  /** Their seat there is switched off. */
  | 'ORG_FORBIDDEN'
  /** Their role there does not hold a key and no competence grants it. */
  | 'AGENT_CONNECT_FORBIDDEN';

interface ConsentOrganization {
  id: string;
  slug: string;
  name: string;
  role: string;
  allowed: boolean;
  /** Why not, when not allowed. */
  reason?: ConsentOrganizationRefusal;
  /** The most their role lets them allow here, in the order the scopes are
   * taught; empty when not allowed. */
  ceiling: AgentScope[];
  /** What they allowed this app here before, while that connection lives. */
  previous: AgentScope[] | null;
}

interface AgentConsentContext {
  client: AgentClientIdentity & { id: string };
  /** The scopes the app asked for that a connection can hold, in the order
   * it asked; anything else it asked for is not shown, as it is not given. */
  requestedScopes: string[];
  /** Whether the person's account may sign in to an organization at all:
   * a verified address and no two-factor enrollment due. */
  eligible: boolean;
  /** The organization the session is working in, to preselect. */
  activeOrganizationId: string | null;
  /** Every organization of the person: the ones they may connect to first,
   * then by name. */
  organizations: ConsentOrganization[];
}

/** Why no context can be given. */
type ConsentContextRefusal = 'CLIENT_NOT_FOUND' | 'NOT_AN_AGENT_REQUEST';

export class ConsentContextError extends Error {
  readonly code: ConsentContextRefusal;
  readonly status: 400 | 404;

  constructor(code: ConsentContextRefusal) {
    super(
      code === 'CLIENT_NOT_FOUND'
        ? 'This app is not known to Tale.'
        : 'This request does not ask for coding agent access.',
    );
    this.name = 'ConsentContextError';
    this.code = code;
    this.status = code === 'CLIENT_NOT_FOUND' ? 404 : 400;
  }
}

interface MembershipRow {
  id: string;
  slug: string;
  name: string;
  role: string;
}

const RESOURCE_SCOPES: ReadonlySet<string> = new Set(MCP_RESOURCE_SCOPES);

export async function readAgentConsentContext(
  sql: Sql,
  args: {
    userId: string;
    activeOrganizationId: string | null;
    clientId: string;
    scope: string | undefined;
  },
): Promise<AgentConsentContext> {
  const asked = scopesOf(args.scope);
  if (!requestsAgentAccess(asked)) {
    throw new ConsentContextError('NOT_AN_AGENT_REQUEST');
  }
  const row = await readAgentClientRow(sql, args.clientId);
  if (row === null) throw new ConsentContextError('CLIENT_NOT_FOUND');
  const client = agentClientIdentity(args.clientId, row);

  const memberships = await sql<MembershipRow[]>`
    SELECT m."organizationId" AS "id", o."slug", o."name", m."role"
    FROM "member" m
    JOIN "organization" o ON o."id" = m."organizationId"
    WHERE m."userId" = ${args.userId}
  `;
  const previous = new Map<string, AgentScope[]>(
    (
      await sql<{ organizationId: string; scopes: string[] }[]>`
        SELECT org_id AS "organizationId", scopes FROM app.agent_connections
        WHERE user_id = ${args.userId} AND client_id = ${args.clientId}
          AND revoked_at_ms IS NULL
      `
    ).map((connection) => [
      connection.organizationId,
      connection.scopes.filter(isAgentScope),
    ]),
  );
  const organizations: ConsentOrganization[] = [];
  for (const membership of memberships) {
    const role = membership.role.toLowerCase();
    const seat =
      role === 'disabled'
        ? false
        : await mayConnectAgentIn(sql, {
            organizationId: membership.id,
            userId: args.userId,
            role,
          });
    organizations.push({
      id: membership.id,
      slug: membership.slug,
      name: membership.name,
      role,
      allowed: seat,
      ...(seat
        ? {}
        : {
            reason:
              role === 'disabled'
                ? ('ORG_FORBIDDEN' as const)
                : ('AGENT_CONNECT_FORBIDDEN' as const),
          }),
      ceiling: seat ? scopeCeilingForRole(role) : [],
      previous: previous.get(membership.id) ?? null,
    });
  }
  organizations.sort(
    (a, b) =>
      Number(b.allowed) - Number(a.allowed) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
      a.id.localeCompare(b.id),
  );

  const verified = await sql<{ emailVerified: boolean }[]>`
    SELECT "emailVerified" FROM "user" WHERE "id" = ${args.userId} LIMIT 1
  `;
  const person = verified[0];
  const eligible = person
    ? person.emailVerified &&
      (await evaluateTwoFactorEnforcement(sql, args.userId)).decision !==
        'blocked'
    : false;

  return {
    client: { ...client, id: args.clientId },
    requestedScopes: asked.filter((scope) => RESOURCE_SCOPES.has(scope)),
    eligible,
    activeOrganizationId: args.activeOrganizationId,
    organizations,
  };
}
