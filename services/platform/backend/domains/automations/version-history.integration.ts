/** Real Postgres proof of an automation's version history (`versions.ts`,
 * migration 0198): each version records what it was based on and what it
 * changed, a history reads a page at a time with the live version marked, a
 * stale save is refused naming who saved the newer version, a restore saves
 * the older content as the newest version (and nothing when it is the
 * latest already), the versions a retention sweep must keep are the live
 * and deployed ones, the newest twenty and their lineage, and a new name
 * cannot end in a word an automation's own pages use, the history names the
 * member behind each actor — and no one else — and an agent's restore saves
 * under the automation it restores, whatever name an old document carries.
 * The lane deletes what it wrote before it ends. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import { dispatch } from '../../../lib/engine/api/dispatch.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import { assembleAutomationAuthoringHost } from '../../core/automations/authoring_host.ts';
import { appOrigin } from '../../lib/write-origin.ts';
import { memberNamesOf } from './author-names.ts';
import { pgAutomationStore } from './dispatch-store.ts';
import {
  AutomationError,
  deleteAutomationCascade,
  deploy,
  saveVersion,
} from './store.ts';
import {
  listVersionHistory,
  protectedVersions,
  restoreVersion,
} from './versions.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

export async function checkVersionHistory(
  sql: Sql,
  ctx: { orgId: string; userId: string },
  record: Recorder,
): Promise<void> {
  const { orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const origin = appOrigin(userId);
  const name = `itest-versions-${suffix}`;
  const kept = `itest-versions-kept-${suffix}`;
  const people = {
    member: `itest-named-${suffix}`,
    nameless: `itest-nameless-${suffix}`,
    former: `itest-former-${suffix}`,
    outsider: `itest-outsider-${suffix}`,
  };
  const otherOrg = `itest-names-org-${suffix}`;
  const agentRestored = `itest-versions-restore-${suffix}`;
  const namedInstead = `itest-versions-named-${suffix}`;
  const complete = `itest-versions-complete-${suffix}`;
  const node = (id: string) => ({
    id,
    type: 'transform',
    code: `return '${id}';`,
  });
  const save = (
    automation: string,
    nodes: string[],
    extra: { baseVersion?: number } = {},
  ) =>
    saveVersion(sql, {
      organizationId: orgId,
      name: automation,
      document: {
        version: 1,
        name: automation,
        nodes: nodes.map(node),
        output: `{{ nodes.${nodes[0] ?? 'a'}.output }}`,
      },
      origin,
      ...extra,
    });

  try {
    await checkMcpVersionHistory(sql, record, {
      orgId,
      userId,
      name: complete,
    });
    const v1 = await save(name, ['a']);
    const v2 = await save(name, ['a', 'b'], { baseVersion: 1 });
    const v3 = await save(name, ['a', 'b', 'c']);
    const history = await listVersionHistory(sql, orgId, name);
    const row = (version: number) =>
      history.versions.find((entry) => entry.version === version);
    record(
      'version history: each version records what it was based on and what it changed against the one before [AUTO-R47]',
      v1.changes?.first === true &&
        v1.changes.nodes.added === 1 &&
        v2.changes?.nodes.added === 1 &&
        v3.changes?.nodes.added === 1 &&
        row(2)?.basedOnVersion === 1 &&
        row(3)?.basedOnVersion === null &&
        row(3)?.changes?.nodes.added === 1 &&
        row(1)?.via === 'app' &&
        row(1)?.viaInferred === false &&
        history.latestVersion === 3 &&
        history.deployedVersion === null,
      JSON.stringify({ v1, v2, v3, history }),
    );

    await deploy(sql, { organizationId: orgId, name, version: 2, origin });
    const page1 = await listVersionHistory(sql, orgId, name, { limit: 2 });
    const page2 =
      page1.nextBefore === null
        ? null
        : await listVersionHistory(sql, orgId, name, {
            limit: 2,
            before: page1.nextBefore,
          });
    const live = page1.versions[1];
    record(
      'version history: reads a page at a time, newest first, the live version marked with when it went live',
      page1.versions.map((entry) => entry.version).join('|') === '3|2' &&
        live !== undefined &&
        live.live &&
        typeof live.lastDeployedAt === 'number' &&
        page1.nextBefore === 2 &&
        page2?.versions.map((entry) => entry.version).join('|') === '1' &&
        page2.nextBefore === null &&
        page2.deployedVersion === 2,
      JSON.stringify({ page1, page2 }),
    );

    const stale = await save(name, ['a', 'z'], { baseVersion: 2 }).catch(
      (error: unknown) => error,
    );
    record(
      'a stale save is refused naming who saved the newer version, when and through which door [AUTO-R3]',
      stale instanceof AutomationError &&
        stale.code === 'AUTOMATION_VERSION_STALE' &&
        stale.data?.latestVersion === 3 &&
        stale.data.latestCreatedBy === userId &&
        stale.data.latestVia === 'app' &&
        typeof stale.data.latestCreatedAt === 'number',
      stale instanceof AutomationError
        ? JSON.stringify({ code: stale.code, data: stale.data })
        : String(stale),
    );

    const restored = await restoreVersion(sql, {
      organizationId: orgId,
      name,
      version: 1,
      origin,
    });
    const again = await restoreVersion(sql, {
      organizationId: orgId,
      name,
      version: 1,
      origin,
    });
    const after = await listVersionHistory(sql, orgId, name);
    const audited = await sql<{ action: string }[]>`
      SELECT action FROM app.audit_logs
      WHERE org_id = ${orgId} AND resource_type = 'automation'
        AND resource_id = ${name}
        AND action = 'automation.version.restored'
    `;
    const restoredRow = after.versions.find((entry) => entry.version === 4);
    record(
      'a restore saves the older content as the newest version, and nothing when it is the latest already [AUTO-R48]',
      restored.version === 4 &&
        restored.restoredFrom === 1 &&
        restored.unchanged === undefined &&
        again.version === 4 &&
        again.unchanged === true &&
        after.latestVersion === 4 &&
        restoredRow?.restoredFromVersion === 1 &&
        restoredRow.basedOnVersion === 1 &&
        restoredRow.message === 'Restore v1' &&
        after.deployedVersion === 2 &&
        audited.length === 1,
      JSON.stringify({ restored, again, after: after.versions[0], audited }),
    );

    // Twenty-three versions, v2 live, v24 restored from v1.
    for (let index = 1; index <= 23; index += 1) {
      await save(kept, ['a', `n${String(index)}`]);
    }
    await deploy(sql, {
      organizationId: orgId,
      name: kept,
      version: 2,
      origin,
    });
    await restoreVersion(sql, {
      organizationId: orgId,
      name: kept,
      version: 1,
      origin,
    });
    const keep = [...(await protectedVersions(sql, orgId, kept))].sort(
      (left, right) => left - right,
    );
    const want = [1, 2, ...Array.from({ length: 20 }, (_, index) => index + 5)];
    record(
      'a retention sweep keeps the live and deployed versions, the newest twenty and what they were restored from',
      JSON.stringify(keep) === JSON.stringify(want),
      `kept=${JSON.stringify(keep)}, want=${JSON.stringify(want)}`,
    );

    const reserved = await save(`itest-ops-${suffix}/versions`, ['a']).catch(
      (error: unknown) => error,
    );
    record(
      'a new name cannot end in a word an automation’s own pages use [AUTO-R49]',
      reserved instanceof AutomationError &&
        reserved.code === 'AUTOMATION_NAME_RESERVED' &&
        reserved.message.includes('"versions" at its end'),
      reserved instanceof AutomationError ? reserved.message : String(reserved),
    );

    // An agent's restore saves under the automation it was asked to restore:
    // a version whose document carries another automation's name (the app
    // never checked) is brought back under the requested name, and the
    // automation the document names is not created or touched.
    assembleAutomationAuthoringHost();
    const asAgent = pgAutomationStore(sql, {
      organizationId: orgId,
      origin: appOrigin(userId),
    });
    await saveVersion(sql, {
      organizationId: orgId,
      name: agentRestored,
      document: {
        version: 1,
        name: namedInstead,
        nodes: [node('a')],
        output: '{{ nodes.a.output }}',
      },
      origin,
    });
    await save(agentRestored, ['a', 'b'], { baseVersion: 1 });
    const brought = await dispatch(
      'save_automation',
      { name: agentRestored, restoreVersion: 1, baseVersion: 2 },
      { store: asAgent },
    );
    const rows = await sql<
      { name: string; version: number; from: number | null }[]
    >`
      SELECT name, version, restored_from_version AS "from"
      FROM app.automations
      WHERE org_id = ${orgId} AND name = ANY(${[agentRestored, namedInstead]})
      ORDER BY name, version
    `;
    record(
      'an agent’s restore saves under the automation it restores, never on the one an old document names [MCP-R32]',
      JSON.stringify(brought).includes('"version":3') &&
        rows.filter((entry) => entry.name === agentRestored).length === 3 &&
        rows.find(
          (entry) => entry.name === agentRestored && entry.version === 3,
        )?.from === 1 &&
        rows.every((entry) => entry.name !== namedInstead),
      JSON.stringify({ brought, rows }),
    );

    // The names a history answers beside its actors: a member's display
    // name for the person an actor names, whichever door they came through;
    // nothing for a nameless member, a former member, a person who belongs
    // to another organization only, or an actor that is no person; never an
    // e-mail address.
    await sql`
      INSERT INTO "organization" ("id", "name", "slug", "createdAt")
      VALUES (${otherOrg}, 'Names Elsewhere', ${otherOrg}, ${new Date()})
    `;
    for (const [id, personName] of [
      [people.member, '  Ada Lovelace '],
      [people.nameless, '   '],
      [people.former, 'Gone Person'],
      [people.outsider, 'Outside Person'],
    ] as const) {
      await sql`
        INSERT INTO "user" ("id", "name", "email", "emailVerified",
                            "createdAt", "updatedAt")
        VALUES (${id}, ${personName}, ${`${id}@example.com`}, true,
                ${new Date()}, ${new Date()})
      `;
    }
    for (const [id, organization] of [
      [people.member, orgId],
      [people.nameless, orgId],
      [people.outsider, otherOrg],
    ] as const) {
      await sql`
        INSERT INTO "member" ("id", "organizationId", "userId", "role",
                              "createdAt")
        VALUES (${`m-${id}`}, ${organization}, ${id}, 'member', ${new Date()})
      `;
    }
    const names = await memberNamesOf(sql, orgId, [
      people.member,
      `api-key:${people.member}`,
      `user:${people.member}`,
      people.nameless,
      people.former,
      `api-key:${people.outsider}`,
      'system:pack',
      'trigger:t-1',
    ]);
    const answered = JSON.stringify([...names.values()]);
    record(
      'a history names the member behind each actor, never a former member, another organization’s person, a system actor or an e-mail address',
      names.get(people.member) === 'Ada Lovelace' &&
        names.get(`api-key:${people.member}`) === 'Ada Lovelace' &&
        names.get(`user:${people.member}`) === 'Ada Lovelace' &&
        names.get(people.nameless) === null &&
        names.get(people.former) === null &&
        names.get(`api-key:${people.outsider}`) === null &&
        names.get('system:pack') === null &&
        names.get('trigger:t-1') === null &&
        !answered.includes('@'),
      answered,
    );
  } finally {
    await sql`DELETE FROM "member" WHERE "userId" = ANY(${Object.values(people)})`.catch(
      (error: unknown) => {
        console.warn(
          '[itest] cleanup of the name probe members:',
          error instanceof Error ? error.message : error,
        );
      },
    );
    await sql`DELETE FROM "user" WHERE "id" = ANY(${Object.values(people)})`.catch(
      (error: unknown) => {
        console.warn(
          '[itest] cleanup of the name probe users:',
          error instanceof Error ? error.message : error,
        );
      },
    );
    await sql`DELETE FROM "organization" WHERE "id" = ${otherOrg}`.catch(
      (error: unknown) => {
        console.warn(
          '[itest] cleanup of the name probe organization:',
          error instanceof Error ? error.message : error,
        );
      },
    );
    for (const automation of [name, kept, agentRestored, complete]) {
      await deleteAutomationCascade(sql, {
        organizationId: orgId,
        name: automation,
        origin,
      }).catch((error: unknown) => {
        console.warn(
          `[itest] cleanup of ${automation}:`,
          error instanceof Error ? error.message : error,
        );
      });
    }
  }
}

/** The production MCP adapter and dispatch must keep their complete-history
 * default across both the app's 50-row default and its 200-row page ceiling.
 * The caller owns this fixture name and removes it in its cleanup. */
export async function checkMcpVersionHistory(
  sql: Sql,
  record: (name: string, ok: boolean, detail: string) => void,
  args: { orgId: string; userId: string; name: string },
): Promise<void> {
  const { orgId, userId, name } = args;
  const origin = appOrigin(userId);
  const store = pgAutomationStore(sql, {
    organizationId: orgId,
    origin,
    visibleOnly: true,
  });
  const read = async (params: { before?: number; limit?: number } = {}) => {
    const answer = await dispatch(
      'list_versions',
      { name, ...params },
      { store },
    );
    if (
      !isRecord(answer) ||
      !Array.isArray(answer.versions) ||
      !answer.versions.every(isRecord)
    ) {
      throw new Error('the MCP version history did not answer versions');
    }
    return {
      versions: answer.versions,
      nextBefore: answer.nextBefore,
      latestVersion: answer.latestVersion,
      deployedVersion: answer.deployedVersion,
    };
  };
  for (let version = 1; version <= 205; version += 1) {
    await saveVersion(sql, {
      organizationId: orgId,
      name,
      document: {
        version: 1,
        name,
        description: `retained version ${String(version === 2 ? 1 : version)}`,
        nodes: [],
      },
      message: `Version ${String(version)}`,
      origin,
      ...(version === 2 ? { basedOnVersion: 1, restoredFromVersion: 1 } : {}),
      testsPassed: true,
      testReport: {
        passed: 1,
        failed: 0,
        results: [{ name: 'kept', pass: true, index: 0, ms: 1 }],
      },
    });
    if (version === 51) {
      const answer = await read();
      record(
        'MCP complete history exceeds the app reader’s 50-row default [MCP-R30]',
        answer.versions.length === 51 &&
          answer.versions.at(-1)?.version === 1 &&
          answer.nextBefore === null,
        JSON.stringify({
          count: answer.versions.length,
          last: answer.versions.at(-1)?.version,
          nextBefore: answer.nextBefore,
        }),
      );
    }
  }
  const answer = await read();
  const oldest = answer.versions.at(-1);
  const restored = answer.versions.find((row) => row.version === 2);
  const authorName =
    (await memberNamesOf(sql, orgId, [userId])).get(userId) ?? null;
  const expected = Array.from({ length: 205 }, (_, index) => 205 - index);
  record(
    'MCP complete history crosses the 200-row ceiling with every retained row and rich metadata [MCP-R30]',
    JSON.stringify(answer.versions.map((row) => row.version)) ===
      JSON.stringify(expected) &&
      answer.latestVersion === 205 &&
      answer.deployedVersion === null &&
      answer.nextBefore === null &&
      oldest?.createdVia === 'app' &&
      oldest.createdBy === userId &&
      oldest.createdByName === authorName &&
      restored?.basedOnVersion === 1 &&
      restored.restoredFromVersion === 1 &&
      isRecord(oldest.tests) &&
      oldest.tests.passed === 1 &&
      oldest.tests.failed === 0 &&
      isRecord(oldest.changes) &&
      oldest.changes.first === true,
    JSON.stringify({
      count: answer.versions.length,
      latest: answer.latestVersion,
      nextBefore: answer.nextBefore,
      oldest,
    }),
  );
  const before = await read({ before: 205 });
  record(
    'MCP before without a limit exhausts the older retained history [MCP-R30]',
    before.versions.length === 204 &&
      before.versions[0]?.version === 204 &&
      before.versions.at(-1)?.version === 1 &&
      before.nextBefore === null,
    JSON.stringify({
      count: before.versions.length,
      first: before.versions[0]?.version,
      last: before.versions.at(-1)?.version,
      nextBefore: before.nextBefore,
    }),
  );
  const page = await read({ limit: 200 });
  const direct = await listVersionHistory(sql, orgId, name);
  record(
    'MCP explicit pages and the app’s direct 50-row default remain bounded [MCP-R30]',
    page.versions.length === 200 &&
      page.nextBefore === 6 &&
      direct.versions.length === 50 &&
      direct.nextBefore === 156,
    JSON.stringify({
      mcpCount: page.versions.length,
      mcpNext: page.nextBefore,
      directCount: direct.versions.length,
      directNext: direct.nextBefore,
    }),
  );
}
