/**
 * Settings over MCP against a real database and a real server: every kind
 * is served, an owner's agent changes the organization's policies,
 * branding, providers, credentials, embedding model and project
 * instructions through the MCP door, each change leaves the audit row its
 * Settings page leaves, stamped as coming through MCP, and a member's
 * agent is refused what a member is refused in the app. Listings are read a
 * page at a time by kind, each page small enough for the answer, a
 * subscription and a provider Tale ships are refused as what they are, and a
 * call that names too many hashes is cut at fifty. An owner's agent allows an
 * automation a write without approval through the General tab's writer, a
 * developer's agent reads that and is refused a change, and a set that moved
 * is stale. The lane works in an organization of its own, so nothing it
 * changes reaches another lane.
 */

import { randomUUID } from 'node:crypto';

import { SETTINGS_KINDS } from '@tale/shared/schemas/settings-kinds';
import type { Sql } from 'postgres';
import { z } from 'zod';

import {
  type RecordCheck,
  signUpUser,
} from '../../integration-lane-helpers.ts';
import { appOrigin } from '../../lib/write-origin.ts';
import { evaluateApprovalGate } from '../approvals/gate.ts';
import { setApprovalAllowances } from '../automations/approval-allowances.ts';
import { deleteAutomationCascade, saveVersion } from '../automations/store.ts';

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
      ownerKinds.data.length === SETTINGS_KINDS.length &&
      ownerKinds.data.every((entry) => entry.available) &&
      access(ownerKinds, 'governance') === '[[true,true]]' &&
      access(memberKinds, 'governance') === '[[true,false]]' &&
      access(memberKinds, 'branding') === '[[false,false]]',
    `owner=${ownerKinds.success ? ownerKinds.data.length : 'unread'} of ${SETTINGS_KINDS.length} kinds, member governance=${access(memberKinds, 'governance')}, member branding=${access(memberKinds, 'branding')}`,
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

  // Listings are paged by kind, and by size: twenty-five more projects, each
  // with the longest instructions one may hold, make several pages, each under
  // the answer the tool advertises, that together read every project once.
  await sql`
    INSERT INTO app.projects (org_id, name, created_by, created_at_ms,
                              updated_at_ms, instructions)
    SELECT ${org.id}, 'Long instructions ' || n, ${owner.userId},
           ${now}::bigint + n, ${now}::bigint + n, repeat('x', 20000)
    FROM generate_series(1, 25) AS n
  `;
  const pageIds: string[] = [];
  const pageChars: number[] = [];
  const pageCursors: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const read = await tool('get_settings', {
      kinds: ['project-instructions'],
      ...(cursor === undefined ? {} : { cursor }),
    });
    // The answer's own text: the envelope also carries it as structured content.
    pageChars.push(JSON.stringify(read.value).length);
    const listed = z
      .array(z.object({ id: z.string() }).loose())
      .safeParse(read.value.resources);
    if (listed.success) pageIds.push(...listed.data.map((item) => item.id));
    const next = z.string().nullable().safeParse(read.value.nextCursor);
    const byKind = z
      .record(z.string(), z.string())
      .safeParse(read.value.cursors);
    if (
      !next.success ||
      !byKind.success ||
      next.data !== (byKind.data['project-instructions'] ?? null)
    ) {
      pageCursors.push('inconsistent');
      break;
    }
    if (next.data === null) break;
    pageCursors.push(next.data);
    cursor = next.data;
  }
  const wrongKind = await tool('get_settings', {
    kinds: ['agent-instructions'],
    cursor: pageCursors[0] ?? 'none',
  });
  const refusedCursor = z
    .array(z.object({ kind: z.string(), code: z.string() }).loose())
    .safeParse(wrongKind.value.refused);
  const several = await tool('get_settings', {
    kinds: ['project-instructions', 'agent-instructions'],
  });
  record(
    'MCP get_settings pages the free-text listings by kind and by size: every project once, each page under the answer the tool advertises, a cursor read by the kind that issued it alone (MCP-R35)',
    pageIds.length === 26 &&
      new Set(pageIds).size === 26 &&
      pageCursors.length >= 2 &&
      !pageCursors.includes('inconsistent') &&
      Math.max(...pageChars) < 250_000 &&
      refusedCursor.success &&
      refusedCursor.data[0]?.code === 'INVALID_CURSOR' &&
      refusedCursor.data[0]?.kind === 'agent-instructions' &&
      several.value.nextCursor === null &&
      JSON.stringify(
        Object.keys(
          z.record(z.string(), z.string()).parse(several.value.cursors),
        ),
      ) === JSON.stringify(['project-instructions']),
    `projects=${pageIds.length}/${new Set(pageIds).size}, pages=${pageCursors.length + 1}, largest answer=${Math.max(...pageChars)} chars, wrong kind=${JSON.stringify(wrongKind.value.refused).slice(0, 160)}, several: nextCursor=${String(several.value.nextCursor)} cursors=${JSON.stringify(several.value.cursors)}`,
  );

  // A subscription is connected through Tale's own flow, a provider Tale
  // ships is no setting, and a call that names too many hashes is cut.
  const subscription = await tool('plan_settings', {
    changes: [
      {
        kind: 'provider-credential',
        op: 'set',
        config: {
          providerSlug: 'openai',
          authMethod: 'subscription-key',
          name: 'Itest subscription',
          envName: null,
          endpointUrl: null,
          modelAllowlist: null,
          status: 'active',
          isDefault: false,
        },
      },
    ],
  });
  const apiKey = await tool('plan_settings', {
    changes: [
      {
        kind: 'provider-credential',
        op: 'set',
        config: {
          providerSlug: 'openai',
          authMethod: 'api-key',
          name: 'Itest key entered in Tale',
          envName: null,
          endpointUrl: null,
          modelAllowlist: null,
          status: 'active',
          isDefault: false,
        },
      },
    ],
  });
  const refusalOf = (answer: ToolAnswer): string => {
    const changes = z
      .array(
        z
          .object({
            refusal: z.object({ code: z.string() }).loose().optional(),
          })
          .loose(),
      )
      .safeParse(answer.value.changes);
    return changes.success
      ? (changes.data[0]?.refusal?.code ?? 'none')
      : 'unread';
  };
  /** The codes get_settings refused its kinds with. */
  const refusalCodes = (answer: ToolAnswer): string[] =>
    z
      .array(z.object({ code: z.string() }).loose())
      .safeParse(answer.value.refused)
      .data?.map((entry) => entry.code) ?? [];
  const shippedRead = await tool('get_settings', {
    kinds: ['provider'],
    ids: ['openai'],
  });
  const shippedRefused = z
    .array(z.object({ code: z.string(), hint: z.string().optional() }).loose())
    .safeParse(shippedRead.value.refused);
  const shippedRefresh = await tool('plan_settings', {
    changes: [
      { kind: 'provider', id: 'openai', op: 'act', act: 'refresh-catalogs' },
    ],
  });
  const strays = Object.fromEntries(
    Array.from({ length: 80 }, (_, index) => [
      `governance/stray-${index}`,
      null,
    ]),
  );
  const flagsKey = 'governance/feature_flags';
  const tooMany = await tool('apply_settings', {
    changes: [flags],
    expected: {
      [flagsKey]: await hashOf('governance', 'feature_flags'),
      ...strays,
    },
  });
  const issues = z
    .object({ issues: z.array(z.unknown()) })
    .safeParse(tooMany.value.data);
  record(
    'MCP refuses a subscription as one connected through Tale, a provider Tale ships as no setting, and lists at most fifty of the hashes a call names for nothing (MCP-R36, MCP-R37, MCP-R11)',
    refusalOf(subscription) === 'USE_SUBSCRIPTION_FLOW' &&
      refusalOf(apiKey) === 'SETTINGS_TALE_ONLY' &&
      shippedRefused.success &&
      shippedRefused.data[0]?.code === 'SETTINGS_NOT_FOUND' &&
      (shippedRefused.data[0]?.hint ?? '').includes('provider-credential') &&
      refusalOf(shippedRefresh) === 'SETTINGS_NOT_FOUND' &&
      tooMany.isError &&
      tooMany.value.code === 'INVALID_ARGUMENTS' &&
      issues.success &&
      issues.data.issues.length === 50,
    `subscription=${refusalOf(subscription)}, key=${refusalOf(apiKey)}, shipped read=${JSON.stringify(shippedRead.value.refused).slice(0, 200)}, refresh=${refusalOf(shippedRefresh)}, strays=${tooMany.isError}/${String(tooMany.value.code)}/${issues.success ? issues.data.issues.length : 'unread'}`,
  );

  // What an automation may write without approval: a developer's agent reads
  // it and is refused a change, a member's is refused the read, an owner's
  // allows a write through the General tab's writer — the gate then lets that
  // automation's write pass while another still asks — a set that moved is
  // stale, and withdrawing makes the write ask again.
  const developer = await signUpUser(base, 'mcp-settings-developer');
  await sql`
    INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
    VALUES (gen_random_uuid(), ${org.id}, ${developer.userId}, 'developer',
            ${new Date()})
  `;
  const developerKey = await mint(
    developer.cookie,
    'itest-mcp-settings-developer',
  );
  const approvalSuffix = randomUUID().slice(0, 8);
  const approved = `approval-probe-${approvalSuffix}`;
  const asking = `approval-other-${approvalSuffix}`;
  const approvalKey = `automation-approval/${approved}`;
  const gate = (automation: string) =>
    evaluateApprovalGate(sql, {
      organizationId: org.id,
      source: 'automation',
      resourceKey: `${automation}:post`,
      connector: 'slack',
      action: 'send_message',
      effect: 'write',
      platformInternal: false,
      automation,
      policyOnly: true,
    });
  const allowancesOf = async (automation: string): Promise<string[]> =>
    (
      await sql<{ connector: string; action: string }[]>`
        SELECT connector, action FROM app.automation_approval_allowances
        WHERE org_id = ${org.id} AND automation_name = ${automation}
        ORDER BY connector, action
      `
    ).map((row) => `${row.connector}.${row.action}`);
  const grantOf = (types: string[], act: 'grant' | 'revoke' = 'grant') => ({
    kind: 'automation-approval',
    id: approved,
    op: 'act',
    act,
    args: { types },
  });
  try {
    for (const automation of [approved, asking]) {
      await saveVersion(sql, {
        organizationId: org.id,
        name: automation,
        document: {
          version: 1,
          name: automation,
          nodes: [{ id: 'post', type: 'slack.send_message' }],
        },
        origin: appOrigin(owner.userId),
      });
    }
    const developerRead = await tool(
      'get_settings',
      { kinds: ['automation-approval'], ids: [approved] },
      developerKey,
    );
    const memberRead = await tool(
      'get_settings',
      { kinds: ['automation-approval'], ids: [approved] },
      memberKey,
    );
    const developerCatalog = kinds.safeParse(
      (await tool('get_settings', {}, developerKey)).value.kinds,
    );
    const emptyRead = await readOf('automation-approval', approved);
    const developerPlan = await tool(
      'plan_settings',
      { changes: [grantOf(['slack.send_message'])] },
      developerKey,
    );
    const developerApply = await apply(
      grantOf(['slack.send_message']),
      approvalKey,
      emptyRead?.hash ?? null,
      developerKey,
    );
    const readOnce = z
      .object({
        allowed: z.array(z.string()),
        used: z.array(z.string()),
        requiredByPolicy: z.array(z.string()),
        grants: z.array(z.unknown()),
      })
      .safeParse(
        z
          .array(z.object({ config: z.unknown() }).loose())
          .safeParse(developerRead.value.resources).data?.[0]?.config,
      );
    record(
      "MCP automation-approval: a developer's agent reads what an automation may write without approval and is refused a change, a member's is refused the read, and the kind is served (MCP-R38)",
      readOnce.success &&
        readOnce.data.allowed.length === 0 &&
        readOnce.data.used.join() === 'slack.send_message' &&
        readOnce.data.grants.length === 0 &&
        refusalCodes(memberRead).join() === 'FORBIDDEN' &&
        access(developerCatalog, 'automation-approval') === '[[true,false]]' &&
        refusalOf(developerPlan) === 'FORBIDDEN' &&
        developerApply.isError &&
        developerApply.value.code === 'FORBIDDEN' &&
        (await allowancesOf(approved)).length === 0,
      `developer read=${developerRead.raw.slice(0, 200)}, member=${refusalCodes(memberRead).join()}, catalog=${access(developerCatalog, 'automation-approval')}, plan=${refusalOf(developerPlan)}, apply=${String(developerApply.value.code)}`,
    );

    const grantPlan = await tool('plan_settings', {
      changes: [grantOf(['slack.send_message'])],
    });
    const plannedGrant = z
      .array(
        z
          .object({
            action: z.string(),
            risk: z.string(),
            effects: z.array(z.string()),
          })
          .loose(),
      )
      .safeParse(grantPlan.value.changes);
    const granted = await apply(
      grantOf(['slack.send_message']),
      approvalKey,
      emptyRead?.hash ?? null,
    );
    const afterGrant = await readOf('automation-approval', approved);
    const grantedConfig = z
      .object({
        allowed: z.array(z.string()),
        grants: z.array(
          z
            .object({
              type: z.string(),
              grantedBy: z.string(),
              grantedByName: z.string().nullable(),
            })
            .loose(),
        ),
      })
      .loose()
      .safeParse(afterGrant?.config);
    const passes = await gate(approved);
    const stillAsks = await gate(asking);
    const appliedHash = z
      .array(z.object({ hash: z.string() }).loose())
      .safeParse(granted.value.applied).data?.[0]?.hash;
    record(
      "MCP automation-approval: an owner's agent allows a write through the General tab's writer — critical in the plan, audited as coming through MCP, the granter named — and the gate lets that automation's write pass while another still asks (MCP-R38, MCP-R39)",
      plannedGrant.success &&
        plannedGrant.data[0]?.action === 'act' &&
        plannedGrant.data[0]?.risk === 'critical' &&
        plannedGrant.data[0]?.effects.join() === 'removes-human-approval' &&
        !granted.isError &&
        (await allowancesOf(approved)).join() === 'slack.send_message' &&
        (await auditedViaMcp('automation.approval_allowance.granted', {
          resourceId: approved,
        })) &&
        appliedHash === afterGrant?.hash &&
        grantedConfig.success &&
        grantedConfig.data.allowed.join() === 'slack.send_message' &&
        grantedConfig.data.grants[0]?.grantedBy === owner.userId &&
        typeof grantedConfig.data.grants[0]?.grantedByName === 'string' &&
        !JSON.stringify(afterGrant).includes('@') &&
        passes.decision === 'allow' &&
        stillAsks.decision === 'needs-approval',
      `plan=${grantPlan.raw.slice(0, 200)}, applied=${granted.raw.slice(0, 160)}, allowances=${(await allowancesOf(approved)).join()}, gate=${passes.decision}/${stillAsks.decision}`,
    );

    // Another person allows a second write while the agent still holds the
    // hash it read: its change is stale, and nothing of it lands.
    const readHash = afterGrant?.hash ?? null;
    await setApprovalAllowances(sql, {
      organizationId: org.id,
      automation: approved,
      allowed: ['slack.send_message', 'http.send'],
      origin: appOrigin(owner.userId),
      grantedBy: owner.userId,
    });
    const staleGrant = await apply(
      grantOf(['github.create_issue']),
      approvalKey,
      readHash,
    );
    const staleData = z
      .object({ currentHash: z.string() })
      .safeParse(staleGrant.value.data);
    const afterMove = await readOf('automation-approval', approved);
    const withdrawn = await apply(
      grantOf(['slack.send_message'], 'revoke'),
      approvalKey,
      afterMove?.hash ?? null,
    );
    const asksAgain = await gate(approved);
    const invalid = await tool('plan_settings', {
      changes: [grantOf(['http.get', 'made.up'])],
    });
    const invalidCode = z
      .array(
        z
          .object({
            refusal: z
              .object({ code: z.string(), data: z.unknown() })
              .loose()
              .optional(),
          })
          .loose(),
      )
      .safeParse(invalid.value.changes);
    record(
      'MCP automation-approval: a set that moved is stale and nothing of the change lands, a name that is no write is refused, and withdrawing makes the write ask again (MCP-R39)',
      staleGrant.isError &&
        staleGrant.value.code === 'SETTINGS_STALE' &&
        staleData.success &&
        staleData.data.currentHash === afterMove?.hash &&
        afterMove?.hash !== readHash &&
        (await allowancesOf(approved)).join() === 'http.send' &&
        !withdrawn.isError &&
        asksAgain.decision === 'needs-approval' &&
        (await auditedViaMcp('automation.approval_allowance.revoked', {
          resourceId: approved,
        })) &&
        invalidCode.success &&
        invalidCode.data[0]?.refusal?.code === 'APPROVAL_ALLOWANCE_INVALID',
      `stale=${String(staleGrant.value.code)}, allowances=${(await allowancesOf(approved)).join()}, gate=${asksAgain.decision}, invalid=${invalid.raw.slice(0, 200)}`,
    );
  } finally {
    for (const automation of [approved, asking]) {
      await deleteAutomationCascade(sql, {
        organizationId: org.id,
        name: automation,
        origin: appOrigin(owner.userId),
      }).catch((error: unknown) => {
        console.warn(
          `[itest] cleanup of ${automation}:`,
          error instanceof Error ? error.message : error,
        );
      });
    }
  }
}
