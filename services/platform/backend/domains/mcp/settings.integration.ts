/**
 * Settings over MCP against a real database and a real server: every kind
 * is served, an owner's agent changes the organization's policies,
 * branding, providers, credentials, embedding model and project
 * instructions through the MCP door, each change leaves the audit row its
 * Settings page leaves, stamped as coming through MCP, and a member's
 * agent is refused what a member is refused in the app. The lane works in
 * an organization of its own, so nothing it changes reaches another lane.
 */

import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  type RecordCheck,
  signUpUser,
} from '../../integration-lane-helpers.ts';

const answerSchema = z.object({
  result: z.object({
    content: z.array(z.object({ text: z.string() })).min(1),
    isError: z.boolean(),
  }),
});

interface ToolAnswer {
  readonly isError: boolean;
  readonly value: Record<string, unknown>;
  readonly raw: string;
}

export async function checkMcpSettingsConfig(
  sql: Sql,
  base: string,
  record: RecordCheck,
): Promise<void> {
  const headers = { 'content-type': 'application/json', origin: base };
  const owner = await signUpUser(base, 'mcp-settings');
  const created = z.object({ id: z.string(), slug: z.string() }).safeParse(
    await (
      await fetch(`${base}/api/auth/organization/create`, {
        method: 'POST',
        headers: { ...headers, cookie: owner.cookie },
        body: JSON.stringify({
          name: 'MCP settings',
          slug: `mcp-settings-${randomUUID().slice(0, 8)}`,
        }),
      })
    ).json(),
  );
  if (!created.success) {
    record(
      'MCP settings: the lane has an organization of its own',
      false,
      created.error.message,
    );
    return;
  }
  const org = created.data;
  const mint = async (cookie: string, name: string): Promise<string> => {
    const minted = z.looseObject({ key: z.string() }).safeParse(
      await (
        await fetch(`${base}/api/auth/api-key/create`, {
          method: 'POST',
          headers: { ...headers, cookie },
          body: JSON.stringify({ name }),
        })
      ).json(),
    );
    return minted.success ? minted.data.key : '';
  };
  const ownerKey = await mint(owner.cookie, 'itest-mcp-settings');
  // A member's key, made the way one arises: minted while a developer,
  // used once the person is a member.
  const member = await signUpUser(base, 'mcp-settings-member');
  await sql`
    INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
    VALUES (gen_random_uuid(), ${org.id}, ${member.userId}, 'developer',
            ${new Date()})
  `;
  const memberKey = await mint(member.cookie, 'itest-mcp-settings-member');
  await sql`
    UPDATE "member" SET "role" = 'member'
    WHERE "organizationId" = ${org.id} AND "userId" = ${member.userId}
  `;

  let rpcId = 7000;
  const tool = async (
    name: string,
    args: Record<string, unknown>,
    key = ownerKey,
  ): Promise<ToolAnswer> => {
    rpcId += 1;
    const res = await fetch(`${base}/api/v1/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
        'x-organization-slug': org.slug,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: rpcId,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    const raw = await res.text();
    const parsed = answerSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { isError: true, value: {}, raw };
    const value = z
      .record(z.string(), z.unknown())
      .safeParse(JSON.parse(parsed.data.result.content[0]?.text ?? '{}'));
    return {
      isError: parsed.data.result.isError,
      value: value.success ? value.data : {},
      raw,
    };
  };
  /** A resource as get_settings reads it: its hash and config, or null
   * when there is none. */
  const readOf = async (
    kind: string,
    id?: string,
  ): Promise<{ hash: string; config: unknown } | null> => {
    const read = await tool('get_settings', {
      kinds: [kind],
      ...(id === undefined ? {} : { ids: [id] }),
    });
    const resources = z
      .array(z.object({ hash: z.string(), config: z.unknown() }).loose())
      .safeParse(read.value.resources);
    return resources.success ? (resources.data[0] ?? null) : null;
  };
  const hashOf = async (kind: string, id?: string): Promise<string | null> =>
    (await readOf(kind, id))?.hash ?? null;
  /** Apply one change, naming the hash it expects. */
  const apply = async (
    change: Record<string, unknown>,
    key: string,
    expected: string | null,
    as = ownerKey,
  ) =>
    tool(
      'apply_settings',
      { changes: [change], expected: { [key]: expected } },
      as,
    );
  /** Whether the latest audit row of an action on a resource came through
   * the settings tool. */
  const auditedViaMcp = async (
    action: string,
    where: { resourceId?: string; resourceName?: string },
  ): Promise<boolean> => {
    const rows = await sql<{ via: string | null; tool: string | null }[]>`
      SELECT metadata->>'via' AS via, metadata->>'tool' AS tool
      FROM app.audit_logs
      WHERE org_id = ${org.id} AND action = ${action}
        AND (${where.resourceId ?? null}::text IS NULL
          OR resource_id = ${where.resourceId ?? null})
        AND (${where.resourceName ?? null}::text IS NULL
          OR resource_name = ${where.resourceName ?? null})
      ORDER BY ts DESC
      LIMIT 1
    `;
    return rows[0]?.via === 'mcp' && rows[0]?.tool === 'apply_settings';
  };

  // The catalog: every kind served, and what each role may do.
  const ownerCatalog = await tool('get_settings', {});
  const memberCatalog = await tool('get_settings', {}, memberKey);
  const kinds = z.array(
    z
      .object({
        kind: z.string(),
        available: z.boolean(),
        read: z.boolean(),
        write: z.boolean(),
      })
      .loose(),
  );
  const ownerKinds = kinds.safeParse(ownerCatalog.value.kinds);
  const memberKinds = kinds.safeParse(memberCatalog.value.kinds);
  const access = (parsed: typeof ownerKinds, kind: string): string =>
    parsed.success
      ? JSON.stringify(
          parsed.data
            .filter((entry) => entry.kind === kind)
            .map((entry) => [entry.read, entry.write]),
        )
      : 'unread';
  record(
    'MCP get_settings serves every kind, and says what the role may do with each (MCP-R10)',
    ownerKinds.success &&
      ownerKinds.data.length === 10 &&
      ownerKinds.data.every((entry) => entry.available) &&
      access(ownerKinds, 'governance') === '[[true,true]]' &&
      access(memberKinds, 'governance') === '[[true,false]]' &&
      access(memberKinds, 'branding') === '[[false,false]]',
    `owner=${ownerKinds.success ? ownerKinds.data.length : 'unread'} kinds, member governance=${access(memberKinds, 'governance')}, member branding=${access(memberKinds, 'branding')}`,
  );

  // A policy: the owner's agent changes it, a member's is refused, and a
  // change from an old read is stale.
  // Whatever a new organization starts with, the change flips it.
  const flagsRead = await readOf('governance', 'feature_flags');
  const flagsBefore = flagsRead?.hash ?? null;
  const enabledBefore = z
    .object({ enabled: z.boolean() })
    .loose()
    .safeParse(flagsRead?.config).data?.enabled;
  const flags = {
    kind: 'governance',
    id: 'feature_flags',
    op: 'set',
    config: { rules: [], enabled: enabledBefore !== true },
  };
  const flagsApplied = await apply(
    flags,
    'governance/feature_flags',
    flagsBefore,
  );
  const flagsAfter = await hashOf('governance', 'feature_flags');
  const memberFlags = await apply(
    { ...flags, config: { rules: [], enabled: enabledBefore === true } },
    'governance/feature_flags',
    flagsAfter,
    memberKey,
  );
  const staleFlags = await apply(
    { ...flags, config: { rules: [], enabled: enabledBefore === true } },
    'governance/feature_flags',
    flagsBefore,
  );
  record(
    "MCP apply_settings changes a policy through its writer, refuses a member's agent and a stale read (MCP-R10, MCP-R11, MCP-R14)",
    !flagsApplied.isError &&
      (await auditedViaMcp(
        flagsBefore === null
          ? 'governance_policy.created'
          : 'governance_policy.updated',
        { resourceId: 'feature_flags' },
      )) &&
      memberFlags.isError &&
      memberFlags.value.code === 'FORBIDDEN' &&
      (await hashOf('governance', 'feature_flags')) === flagsAfter &&
      staleFlags.isError &&
      staleFlags.value.code === 'SETTINGS_STALE' &&
      z.object({ currentHash: z.string() }).safeParse(staleFlags.value.data)
        .data?.currentHash === flagsAfter,
    `applied=${flagsApplied.raw.slice(0, 160)}, member=${String(memberFlags.value.code)}, stale=${String(staleFlags.value.code)}`,
  );

  // The branding.
  const accentColor = `#${randomUUID().replaceAll('-', '').slice(0, 6)}`;
  const branding = await apply(
    { kind: 'branding', op: 'set', config: { accentColor } },
    'branding',
    await hashOf('branding'),
  );
  record(
    'MCP apply_settings changes the branding through its writer, audited as coming through MCP (MCP-R14)',
    !branding.isError &&
      (await auditedViaMcp('branding.updated', { resourceId: org.id })),
    branding.raw.slice(0, 200),
  );

  // A provider of the organization's own, a credential for it read from
  // the environment, and an embedding model on it — the knowledge base is
  // empty, so the model may be set.
  const providerName = 'itest-mcp-settings';
  const provider = await apply(
    {
      kind: 'provider',
      op: 'set',
      config: {
        name: providerName,
        displayName: 'Itest MCP settings',
        apiFormat: 'openai',
        baseUrl: 'https://models.example.test/v1',
        catalog: { source: 'models-endpoint' },
        embedding: 'unknown',
        auth: [{ method: 'env' }],
      },
    },
    `provider/${providerName}`,
    null,
  );
  const credentialId = `${providerName}/Itest%20key`;
  const credential = await apply(
    {
      kind: 'provider-credential',
      op: 'set',
      config: {
        providerSlug: providerName,
        authMethod: 'env',
        name: 'Itest key',
        envName: 'TALE_PROVIDER_KEY_ITEST_MCP_SETTINGS',
        endpointUrl: null,
        modelAllowlist: null,
        status: 'active',
        isDefault: true,
      },
    },
    `provider-credential/${credentialId}`,
    null,
  );
  const embedding = await apply(
    {
      kind: 'knowledge-embedding',
      op: 'set',
      config: {
        providerSlug: providerName,
        model: 'itest-embedding',
        dimensions: 256,
      },
    },
    'knowledge-embedding',
    await hashOf('knowledge-embedding'),
  );
  const credentialInUse = await tool('plan_settings', {
    changes: [{ kind: 'provider-credential', id: credentialId, op: 'delete' }],
  });
  const plannedRefusal = z
    .array(
      z.object({ refusal: z.object({ code: z.string() }).loose() }).loose(),
    )
    .safeParse(credentialInUse.value.changes);
  record(
    'MCP apply_settings defines a provider, its environment credential and the embedding model through their writers, each audited as coming through MCP (MCP-R14, MCP-R28)',
    !provider.isError &&
      (await auditedViaMcp('provider_definition.saved', {
        resourceId: providerName,
      })) &&
      !credential.isError &&
      (await auditedViaMcp('provider_credential.created', {
        resourceName: 'Itest key',
      })) &&
      !embedding.isError &&
      (await auditedViaMcp('knowledge_embedding.saved', {
        resourceId: 'embedding',
      })) &&
      plannedRefusal.success &&
      plannedRefusal.data[0]?.refusal.code === 'CREDENTIAL_IN_USE',
    `provider=${provider.raw.slice(0, 120)}, credential=${credential.raw.slice(0, 120)}, embedding=${embedding.raw.slice(0, 120)}, delete=${credentialInUse.raw.slice(0, 120)}`,
  );

  // A project's instructions.
  const now = Date.now();
  const projects = await sql<{ id: string }[]>`
    INSERT INTO app.projects (org_id, name, created_by, created_at_ms,
                              updated_at_ms)
    VALUES (${org.id}, 'MCP settings project', ${owner.userId}, ${now}, ${now})
    RETURNING id
  `;
  const projectId = projects[0]?.id ?? '';
  const instructions = await apply(
    {
      kind: 'project-instructions',
      op: 'set',
      config: { projectId, instructions: 'Answer in one paragraph.' },
    },
    `project-instructions/${projectId}`,
    await hashOf('project-instructions', projectId),
  );
  const memberInstructions = await apply(
    {
      kind: 'project-instructions',
      op: 'set',
      config: { projectId, instructions: 'Answer at length.' },
    },
    `project-instructions/${projectId}`,
    await hashOf('project-instructions', projectId),
    memberKey,
  );
  record(
    "MCP apply_settings changes a project's instructions through the managed writer, and refuses a member who may not edit the project (MCP-R10, MCP-R14)",
    !instructions.isError &&
      (await auditedViaMcp('project.instructions.changed', {
        resourceId: projectId,
      })) &&
      memberInstructions.isError,
    `owner=${instructions.raw.slice(0, 160)}, member=${String(memberInstructions.value.code)}`,
  );
}
