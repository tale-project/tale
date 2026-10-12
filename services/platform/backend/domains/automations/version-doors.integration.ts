/** Real HTTP and Postgres proof of the version doors: an agent reads the
 * history a page at a time, compares a version with another and brings an
 * older one back over MCP (MCP-R30 to MCP-R32), and a release pipeline does
 * the same over REST with a key — the history in pages, when each version
 * went live, a comparison, a deploy that names what it replaces and a
 * restore — each write audited as the key's, a member's key refused, a
 * version whose tests fail refused with its report, and an automation
 * installed only in a project the member cannot read answered as not found.
 * An agent also runs an automation on stand-ins and picks which tests to run
 * by name (MCP-R33, MCP-R34): the whole suite of a saved version is recorded
 * on it, a part is not, and what the runs draw from the organization's
 * budget for runs that are never stored is refused with the wait once spent.
 * The lane deletes what it wrote before it ends. */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { appOrigin } from '../../lib/write-origin.ts';
import { admitBenchRuns } from './bench.ts';
import { deleteAutomationCascade } from './store.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

const json = z.record(z.string(), z.unknown());

export async function checkVersionDoors(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  member: { cookie: string; userId: string },
  orgSlug: string,
  record: Recorder,
): Promise<void> {
  const { cookie, orgId, userId } = ctx;
  const suffix = randomUUID().slice(0, 8);
  const name = `itest-doors-${suffix}/dunning`;
  const benchName = `itest-doors-${suffix}/orders`;
  const slug = name.replaceAll('/', '__');
  const teamId = randomUUID();
  let projectId: string | null = null;

  const mintKey = async (asCookie: string, label: string): Promise<string> => {
    const minted = z.looseObject({ key: z.string() }).safeParse(
      await (
        await fetch(`${base}/api/auth/api-key/create`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: asCookie,
            origin: base,
          },
          body: JSON.stringify({ name: label }),
        })
      ).json(),
    );
    return minted.success ? minted.data.key : '';
  };
  const ownerKey = await mintKey(cookie, `itest-doors-owner-${suffix}`);
  // A member's key arises in production from a developer later moved to a
  // lower role: seat the member as a developer for the create, then back.
  const seat = await sql<{ role: string }[]>`
    SELECT "role" FROM "member"
    WHERE "organizationId" = ${orgId} AND "userId" = ${member.userId}
  `;
  const seatRole = seat[0]?.role ?? 'member';
  await sql`
    UPDATE "member" SET "role" = 'developer'
    WHERE "organizationId" = ${orgId} AND "userId" = ${member.userId}
  `;
  let memberKey = '';
  try {
    memberKey = await mintKey(member.cookie, `itest-doors-member-${suffix}`);
  } finally {
    await sql`
      UPDATE "member" SET "role" = ${seatRole}
      WHERE "organizationId" = ${orgId} AND "userId" = ${member.userId}
    `;
  }

  let rpcId = 900;
  /** One MCP tool call: whether it was refused, and the JSON it answered. */
  const tool = async (
    toolName: string,
    args: Record<string, unknown>,
    key = ownerKey,
  ): Promise<{ isError: boolean; value: Record<string, unknown> }> => {
    rpcId += 1;
    const res = await fetch(`${base}/api/v1/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
        'x-organization-slug': orgSlug,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: rpcId,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
    });
    const parsed = z
      .object({
        result: z.object({
          content: z.array(z.object({ text: z.string() })).min(1),
          isError: z.boolean(),
        }),
      })
      .safeParse(await res.json());
    if (!parsed.success) return { isError: true, value: {} };
    const value = json.safeParse(
      JSON.parse(parsed.data.result.content[0]?.text ?? '{}'),
    );
    return {
      isError: parsed.data.result.isError,
      value: value.success ? value.data : {},
    };
  };
  /** One REST call on the automation, with the key's own door. */
  const rest = async (
    path: string,
    init: { method?: string; body?: unknown; key?: string } = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const res = await fetch(`${base}/api/v1/automations/${slug}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${init.key ?? ownerKey}`,
        'x-organization-slug': orgSlug,
        ...(init.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const text = await res.text();
    const parsed = json.safeParse(text === '' ? {} : JSON.parse(text));
    return { status: res.status, body: parsed.success ? parsed.data : {} };
  };
  const versionsOf = (value: Record<string, unknown>): number[] => {
    const parsed = z
      .object({ versions: z.array(z.looseObject({ version: z.number() })) })
      .safeParse(value);
    return parsed.success ? parsed.data.versions.map((v) => v.version) : [];
  };
  const rowOf = (value: Record<string, unknown>, version: number) => {
    const parsed = z
      .object({ versions: z.array(z.looseObject({ version: z.number() })) })
      .safeParse(value);
    return parsed.success
      ? (parsed.data.versions.find((v) => v.version === version) ?? null)
      : null;
  };
  const doc = (n: number, extra: Record<string, unknown> = {}) => ({
    version: 1,
    name,
    description: `cut ${String(n)}`,
    nodes: [{ id: 'one', type: 'transform', code: `return ${String(n)};` }],
    output: '{{ nodes.one.output }}',
    ...extra,
  });
  const ownerName =
    (
      await sql<{ name: string | null }[]>`
        SELECT "name" FROM "user" WHERE "id" = ${userId}
      `
    )[0]?.name?.trim() || null;

  try {
    // Three versions and v2 live, over MCP.
    const saves = [
      await tool('save_automation', {
        automation: doc(1),
        message: 'one',
        create: true,
      }),
      await tool('save_automation', {
        automation: doc(2),
        message: 'two',
        baseVersion: 1,
      }),
      await tool('save_automation', {
        automation: doc(3),
        message: 'three',
        baseVersion: 2,
      }),
    ];
    const deployedTwo = await tool('deploy_automation', {
      name,
      version: 2,
    });
    const setupOk =
      saves.every((save) => !save.isError) && !deployedTwo.isError;

    // MCP-R30: a page of the history with who, how and what.
    const first = await tool('list_versions', { name, limit: 2 });
    const second = await tool('list_versions', {
      name,
      limit: 2,
      before: first.value.nextBefore,
    });
    const three = rowOf(first.value, 3);
    record(
      'over MCP the history is read a page at a time, each version with its door, author, lineage and changes [MCP-R30]',
      setupOk &&
        !first.isError &&
        versionsOf(first.value).join() === '3,2' &&
        first.value.nextBefore === 2 &&
        first.value.latestVersion === 3 &&
        first.value.deployedVersion === 2 &&
        three?.createdVia === 'mcp' &&
        three.basedOnVersion === 2 &&
        three.createdByName === ownerName &&
        isRecordWith(three.changes, 'description', true) &&
        versionsOf(second.value).join() === '1' &&
        second.value.nextBefore === null,
      `setup=${setupOk}, page 1=${JSON.stringify(first.value).slice(0, 360)}, page 2=${versionsOf(second.value).join()}`,
    );

    // MCP-R31: what a version changed against the live one.
    const against = await tool('get_automation', {
      name,
      version: 3,
      against: 'deployed',
      diffFormat: 'both',
    });
    const diff = json.safeParse(against.value.diff);
    record(
      'over MCP a version is read against the live one: what it changed, and the patch between their YAML [MCP-R31]',
      !against.isError &&
        diff.success &&
        diff.data.from === 2 &&
        diff.data.to === 3 &&
        diff.data.identical === false &&
        typeof diff.data.unified === 'string' &&
        diff.data.unified.includes('--- v2') &&
        diff.data.unified.includes('+++ v3') &&
        diff.data.unified.includes('+description: cut 3'),
      `diff=${JSON.stringify(against.value.diff).slice(0, 300)}`,
    );

    // MCP-R32: an older version back as the newest; the live one stays.
    const restored = await tool('save_automation', {
      name,
      restoreVersion: 1,
      baseVersion: 3,
      message: 'back to one',
    });
    const again = await tool('save_automation', { name, restoreVersion: 1 });
    const stale = await tool('save_automation', {
      name,
      restoreVersion: 2,
      baseVersion: 3,
    });
    const afterRestore = await tool('list_versions', { name, limit: 1 });
    const four = rowOf(afterRestore.value, 4);
    record(
      'over MCP an older version comes back as the newest, once; the live version stays live; a stale base is refused [MCP-R32]',
      !restored.isError &&
        restored.value.version === 4 &&
        restored.value.restoredFrom === 1 &&
        !again.isError &&
        again.value.unchanged === true &&
        again.value.version === 4 &&
        stale.isError &&
        stale.value.code === 'AUTOMATION_VERSION_STALE' &&
        four?.restoredFromVersion === 1 &&
        four.basedOnVersion === 1 &&
        afterRestore.value.deployedVersion === 2,
      `restored=${JSON.stringify(restored.value).slice(0, 160)}, again=${String(again.value.unchanged)}, stale=${String(stale.value.code)}, row=${JSON.stringify(four ?? null).slice(0, 200)}`,
    );

    // REST: the history, whole and in pages, and a comparison.
    const whole = await rest('/versions');
    const page1 = await rest('/versions?limit=3');
    const cursor =
      typeof page1.body.continueCursor === 'string'
        ? page1.body.continueCursor
        : '';
    const page2 = await rest(
      `/versions?limit=3&cursor=${encodeURIComponent(cursor)}`,
    );
    const forged = await rest('/versions?limit=3&cursor=forged');
    const restTwo = rowOf(whole.body, 2);
    const restFour = rowOf(whole.body, 4);
    record(
      'over REST the history is whole without a limit and paged with a signed cursor, each version naming its door and author [AUTO-R47]',
      whole.status === 200 &&
        versionsOf(whole.body).join() === '4,3,2,1' &&
        whole.body.isDone === true &&
        whole.body.continueCursor === '' &&
        whole.body.deployedVersion === 2 &&
        whole.body.latestVersion === 4 &&
        restTwo?.deployed === true &&
        restTwo.createdVia === 'mcp' &&
        restTwo.createdByName === ownerName &&
        restFour?.restoredFromVersion === 1 &&
        page1.status === 200 &&
        versionsOf(page1.body).join() === '4,3,2' &&
        page1.body.isDone === false &&
        cursor !== '' &&
        versionsOf(page2.body).join() === '1' &&
        page2.body.isDone === true &&
        forged.status === 400 &&
        forged.body.code === 'INVALID_CURSOR',
      `whole=${versionsOf(whole.body).join()}, page1=${versionsOf(page1.body).join()}/${String(page1.body.isDone)}, page2=${versionsOf(page2.body).join()}, forged=${forged.status}/${String(forged.body.code)}`,
    );
    const compared = await rest('/compare');
    const comparedLive = await rest('/compare?from=deployed&to=latest');
    const comparedMissing = await rest('/compare?from=1&to=99');
    record(
      'over REST two versions are compared, by number or by name, and a version the automation never had is not found',
      compared.status === 200 &&
        compared.body.from === 3 &&
        compared.body.to === 4 &&
        isRecordWith(compared.body.description, 'kind', 'changed') &&
        comparedLive.status === 200 &&
        comparedLive.body.from === 2 &&
        comparedMissing.status === 404 &&
        comparedMissing.body.code === 'AUTOMATION_VERSION_UNKNOWN',
      `default=${compared.status}/${String(compared.body.from)}→${String(compared.body.to)}, live=${comparedLive.status}/${String(comparedLive.body.from)}, missing=${comparedMissing.status}/${String(comparedMissing.body.code)}`,
    );

    // REST deploys: refused for a member, refused when another version is
    // live, refused with the tests' report, and each answering what it did.
    const memberDeploy = await rest('/deployments', {
      method: 'POST',
      body: { version: 3 },
      key: memberKey,
    });
    const staleDeploy = await rest('/deployments', {
      method: 'POST',
      body: { version: 3, expectedDeployedVersion: 1 },
    });
    const liveStill = await rest('/deployments');
    const forward = await rest('/deployments', {
      method: 'POST',
      body: { version: 3, expectedDeployedVersion: 2 },
    });
    const back = await rest('/deployments', {
      method: 'POST',
      body: { version: 1, expectedDeployedVersion: 3 },
    });
    const already = await rest('/deployments', {
      method: 'POST',
      body: { version: 1 },
    });
    const unknown = await rest('/deployments', {
      method: 'POST',
      body: { version: 99 },
    });
    const failing = await tool('save_automation', {
      automation: doc(6, {
        tests: [{ name: 'says nope', input: {}, expect: { output: 'nope' } }],
      }),
      message: 'a test that fails',
      baseVersion: 4,
    });
    const refusedTests = await rest('/deployments', {
      method: 'POST',
      body: { version: 5 },
    });
    record(
      'over REST a deploy names what it replaces, rolls back, finds a live version unchanged, and is refused for a member, a stale base, an unknown version and failing tests',
      memberDeploy.status === 403 &&
        memberDeploy.body.code === 'ROLE_FORBIDDEN' &&
        staleDeploy.status === 409 &&
        staleDeploy.body.code === 'AUTOMATION_DEPLOYMENT_STALE' &&
        isRecordWith(liveStill.body.live, 'version', 2) &&
        forward.status === 200 &&
        forward.body.kind === 'deploy' &&
        forward.body.version === 3 &&
        forward.body.previousVersion === 2 &&
        typeof forward.body.deploymentId === 'string' &&
        back.status === 200 &&
        back.body.kind === 'rollback' &&
        back.body.previousVersion === 3 &&
        already.status === 200 &&
        already.body.kind === 'unchanged' &&
        already.body.deploymentId === null &&
        unknown.status === 404 &&
        unknown.body.code === 'AUTOMATION_VERSION_UNKNOWN' &&
        !failing.isError &&
        failing.value.version === 5 &&
        refusedTests.status === 409 &&
        refusedTests.body.code === 'AUTOMATION_TESTS_FAILING' &&
        isRecordWith(isRecordOf(refusedTests.body.data)?.report, 'failed', 1),
      `member=${memberDeploy.status}/${String(memberDeploy.body.code)}, stale=${staleDeploy.status}/${String(staleDeploy.body.code)}, forward=${JSON.stringify(forward.body).slice(0, 200)}, back=${String(back.body.kind)}, already=${String(already.body.kind)}, unknown=${unknown.status}, tests=${refusedTests.status}/${String(refusedTests.body.code)}`,
    );

    // REST: when each version went live, with the key's door.
    const deployments = await rest('/deployments');
    const events = z
      .object({
        live: z.looseObject({ version: z.number() }).nullable(),
        deployments: z.array(
          z.looseObject({
            version: z.number(),
            kind: z.string(),
            via: z.string().nullable(),
            deployedByName: z.string().nullable(),
          }),
        ),
      })
      .safeParse(deployments.body);
    const pageOne = await rest('/deployments?limit=1');
    const pageCursor =
      typeof pageOne.body.continueCursor === 'string'
        ? pageOne.body.continueCursor
        : '';
    const pageTwo = await rest(
      `/deployments?limit=1&cursor=${encodeURIComponent(pageCursor)}`,
    );
    const listed = events.success ? events.data.deployments : [];
    record(
      'over REST the deployment history lists each deploy newest first with its door and the member behind it, what is live, and pages with a signed cursor',
      deployments.status === 200 &&
        events.success &&
        events.data.live?.version === 1 &&
        listed
          .slice(0, 3)
          .map((event) => event.version)
          .join() === '1,3,2' &&
        listed[0]?.kind === 'rollback' &&
        listed[0].via === 'rest' &&
        listed[1]?.via === 'rest' &&
        listed[2]?.via === 'mcp' &&
        listed.every((event) => event.deployedByName === ownerName) &&
        pageOne.body.isDone === false &&
        pageCursor !== '' &&
        pageTwo.status === 200 &&
        isRecordWith(
          (Array.isArray(pageTwo.body.deployments)
            ? pageTwo.body.deployments
            : [])[0],
          'version',
          3,
        ),
      `live=${events.success ? String(events.data.live?.version) : 'ERR'}, events=${listed.map((event) => `${event.version}/${event.kind}/${String(event.via)}`).join(' ')}, page1.isDone=${String(pageOne.body.isDone)}`,
    );

    // REST restores: the newest, once, refused for a member and a stale
    // base, and never a deploy.
    const memberRestore = await rest('/versions/2/restore', {
      method: 'POST',
      body: {},
      key: memberKey,
    });
    const staleRestore = await rest('/versions/2/restore', {
      method: 'POST',
      body: { baseVersion: 3 },
    });
    const restoredRest = await rest('/versions/2/restore', {
      method: 'POST',
      body: { message: 'Back to two', baseVersion: 5 },
    });
    const restoredAgain = await rest('/versions/2/restore', {
      method: 'POST',
      body: {},
    });
    const missingRestore = await rest('/versions/99/restore', {
      method: 'POST',
      body: {},
    });
    const afterRest = await rest('/versions?limit=1');
    record(
      'over REST an older version comes back as the newest, once, never live, and is refused for a member, a stale base and a version never saved',
      memberRestore.status === 403 &&
        memberRestore.body.code === 'ROLE_FORBIDDEN' &&
        staleRestore.status === 409 &&
        staleRestore.body.code === 'AUTOMATION_VERSION_STALE' &&
        isRecordWith(isRecordOf(staleRestore.body.data), 'latestVersion', 5) &&
        restoredRest.status === 201 &&
        restoredRest.body.version === 6 &&
        restoredRest.body.restoredFrom === 2 &&
        restoredAgain.status === 200 &&
        restoredAgain.body.unchanged === true &&
        restoredAgain.body.version === 6 &&
        missingRestore.status === 404 &&
        missingRestore.body.code === 'AUTOMATION_VERSION_UNKNOWN' &&
        afterRest.body.deployedVersion === 1 &&
        rowOf(afterRest.body, 6)?.restoredFromVersion === 2,
      `member=${memberRestore.status}, stale=${staleRestore.status}/${String(staleRestore.body.code)}, restored=${JSON.stringify(restoredRest.body).slice(0, 160)}, again=${String(restoredAgain.body.unchanged)}, missing=${missingRestore.status}, live=${String(afterRest.body.deployedVersion)}`,
    );

    // Each REST write is the key's: its door, its id and the request id.
    const audit = await sql<
      {
        action: string;
        via: string | null;
        apiKeyId: string | null;
        requestId: string | null;
        version: string | null;
      }[]
    >`
      SELECT action, metadata->>'via' AS via, metadata->>'apiKeyId' AS "apiKeyId",
             request_id AS "requestId", new_state->>'version' AS version
      FROM app.audit_logs
      WHERE org_id = ${orgId} AND resource_type = 'automation'
        AND resource_id = ${name}
        AND action IN (
          'automation.deployed',
          'automation.rolled_back',
          'automation.version.restored'
        )
      ORDER BY ts
    `;
    const asKey = (action: string) =>
      audit.filter(
        (row) =>
          row.action === action &&
          row.via === 'api-key' &&
          typeof row.apiKeyId === 'string' &&
          row.apiKeyId !== '' &&
          row.requestId !== null,
      );
    record(
      'a deploy, a rollback and a restore made over REST are audited as the key’s, with its id and the request',
      asKey('automation.deployed').length === 1 &&
        asKey('automation.rolled_back').length === 1 &&
        asKey('automation.version.restored').length === 1,
      `rows=${JSON.stringify(audit.map((row) => `${row.action}/${row.via ?? '-'}`))}`,
    );

    // MCP-R33 and MCP-R34: an automation with three tests, run on stand-ins
    // and by name over the real endpoint.
    const benchDoc = {
      version: 1,
      name: benchName,
      inputs: {
        type: 'object',
        properties: { n: { type: 'number' } },
        required: ['n'],
      },
      nodes: [
        {
          id: 'double',
          type: 'transform',
          input: { n: '{{ input.n }}' },
          code: 'return { n: input.n * 2 };',
        },
        {
          id: 'label',
          type: 'transform',
          input: { n: '{{ nodes.double.output.n }}' },
          code: 'return { text: "n=" + input.n };',
        },
      ],
      output: '{{ nodes.label.output.text }}',
      tests: [
        { name: 'doubles 2', input: { n: 2 }, expect: { output: 'n=4' } },
        { name: 'doubles 5', input: { n: 5 }, expect: { output: 'n=10' } },
        {
          name: 'stands in for double',
          input: { n: 1 },
          mocks: { double: { n: 100 } },
          expect: { output: 'n=100' },
        },
      ],
    };
    const savedBench = await tool('save_automation', {
      automation: benchDoc,
      message: 'three tests',
      create: true,
    });
    const testsOf = async () => {
      const history = await tool('list_versions', { name: benchName });
      return isRecordOf(rowOf(history.value, 1)?.tests);
    };
    const bySave = await testsOf();
    const part = await tool('test_automation', {
      name: benchName,
      tests: ['doubles 5'],
    });
    const afterPart = await testsOf();
    const wholeRun = await tool('test_automation', {
      name: benchName,
      detail: ['output'],
    });
    const afterWhole = await testsOf();
    const wholeResults = Array.isArray(wholeRun.value.results)
      ? wholeRun.value.results
      : [];
    const unknownTest = await tool('test_automation', {
      name: benchName,
      tests: ['doubles 7'],
    });
    record(
      'over MCP the tests named run alone and leave the version’s verdict as it was; the whole suite is recorded on the version as made by hand, and says so [MCP-R33]',
      !savedBench.isError &&
        bySave?.via === 'save' &&
        bySave.total === 3 &&
        !part.isError &&
        part.value.passed === 1 &&
        part.value.failed === 0 &&
        !('recorded' in part.value) &&
        Array.isArray(part.value.results) &&
        part.value.results.length === 1 &&
        isRecordWith(part.value.results[0], 'name', 'doubles 5') &&
        afterPart?.via === 'save' &&
        !wholeRun.isError &&
        wholeRun.value.passed === 3 &&
        isRecordWith(wholeRun.value.recorded, 'version', 1) &&
        isRecordWith(wholeRun.value.recorded, 'testsPassed', true) &&
        wholeResults.length === 3 &&
        wholeResults.every(
          (result) =>
            isRecordWith(isRecordOf(result)?.run, 'status', 'success') &&
            !('record' in (isRecordOf(isRecordOf(result)?.run) ?? {})),
        ) &&
        afterWhole?.via === 'manual' &&
        afterWhole.passed === 3 &&
        unknownTest.isError &&
        unknownTest.value.code === 'INVALID_PARAMS' &&
        String(unknownTest.value.hint).includes('doubles 5'),
      `saved=${String(!savedBench.isError)}, save verdict=${JSON.stringify(bySave)}, part=${String(part.value.passed)}/${String(part.value.failed)}/${String(part.value.recorded)}, after part=${String(afterPart?.via)}, whole suite=${JSON.stringify(wholeRun.value.recorded)}, after the whole suite=${JSON.stringify(afterWhole)}, unknown=${String(unknownTest.value.code)}`,
    );

    const standIn = await tool('run_automation', {
      automation: benchDoc,
      input: { n: 3 },
      only: 'label',
      mocks: { double: { n: 7 } },
    });
    const unusedStandIn = await tool('run_automation', {
      automation: {
        ...benchDoc,
        nodes: [
          benchDoc.nodes[0],
          { ...benchDoc.nodes[1], when: '{{ input.n > 100 }}' },
        ],
        output: '{{ nodes.double.output.n }}',
      },
      input: { n: 3 },
      mocks: { label: { text: 'x' } },
    });
    const badBench = await tool('run_automation', {
      automation: benchDoc,
      input: { n: 3 },
      mocks: { dubble: { n: 1 } },
    });
    record(
      'over MCP a run stands in for the nodes it is given, runs one step on pinned data, says which stand-ins it never used, and refuses a node the document lacks [MCP-R34]',
      !standIn.isError &&
        isRecordWith(standIn.value.output, 'text', 'n=7') &&
        isRecordWith(standIn.value.focus, 'node', 'label') &&
        isRecordWith(standIn.value.focus, 'kind', 'only') &&
        !unusedStandIn.isError &&
        JSON.stringify(unusedStandIn.value.unusedMocks) ===
          JSON.stringify(['label']) &&
        badBench.isError &&
        badBench.value.code === 'BENCH_INVALID' &&
        isRecordWith(
          isRecordOf(badBench.value.data)?.issue,
          'code',
          'BENCH_UNKNOWN_NODE',
        ),
      `only=${JSON.stringify(standIn.value).slice(0, 200)}, unused=${JSON.stringify(unusedStandIn.value.unusedMocks)}, bad=${String(badBench.value.code)}/${JSON.stringify(badBench.value.data).slice(0, 160)}`,
    );

    // The runs are charged to the organization's bench budget: spent, the
    // next call is refused with the wait, and runs nothing.
    await sql`DELETE FROM app.rate_limits WHERE name = 'automation:bench'`;
    (await admitBenchRuns(sql, orgId, 240))();
    const spentTests = await tool('test_automation', { name: benchName });
    const spentRun = await tool('run_automation', {
      automation: benchDoc,
      input: { n: 1 },
    });
    await sql`DELETE FROM app.rate_limits WHERE name = 'automation:bench'`;
    const refilled = await tool('test_automation', { name: benchName });
    record(
      'over MCP a suite or a run is refused with the wait once the organization’s budget for runs that are never stored is spent, and is served again after [MCP-R33]',
      spentTests.isError &&
        spentTests.value.code === 'RATE_LIMITED' &&
        typeof isRecordOf(spentTests.value.data)?.retryAfterMs === 'number' &&
        spentRun.isError &&
        spentRun.value.code === 'RATE_LIMITED' &&
        !refilled.isError &&
        refilled.value.passed === 3,
      `tests=${String(spentTests.value.code)}/${JSON.stringify(spentTests.value.data)}, run=${String(spentRun.value.code)}, after=${String(refilled.value.passed)}`,
    );

    // An automation installed only in a project a member cannot read is not
    // found to them on every one of these reads.
    await sql`
      INSERT INTO "team" ("id", "name", "organizationId", "createdAt", "updatedAt")
      VALUES (${teamId}, 'Doors HR', ${orgId}, ${new Date()}, ${new Date()})
    `;
    const now = Date.now();
    const projectRows = await sql<{ id: string }[]>`
      INSERT INTO app.projects (org_id, name, team_id, created_by, created_at_ms,
                                updated_at_ms)
      VALUES (${orgId}, 'Doors HR project', ${teamId}, ${userId}, ${now}, ${now})
      RETURNING id
    `;
    projectId = projectRows[0]?.id ?? null;
    const installed = await tool('set_automation_projects', {
      name,
      add: [projectId ?? ''],
    });
    const hidden = await Promise.all(
      ['/versions', '/deployments', '/compare'].map((path) =>
        rest(path, { key: memberKey }),
      ),
    );
    const visible = await rest('/deployments');
    const hiddenMcp = await tool('list_versions', { name }, memberKey);
    record(
      'an automation installed only in a project the member cannot read is not found to them: versions, deployments, comparison and the MCP history',
      !installed.isError &&
        hidden.every(
          (answer) =>
            answer.status === 404 &&
            answer.body.code === 'AUTOMATION_NOT_FOUND',
        ) &&
        visible.status === 200 &&
        hiddenMcp.isError &&
        hiddenMcp.value.code === 'AUTOMATION_NOT_FOUND',
      `member=${hidden.map((answer) => `${answer.status}/${String(answer.body.code)}`).join(' ')}, owner=${visible.status}, mcp=${String(hiddenMcp.value.code)}`,
    );
  } finally {
    if (projectId !== null) {
      await sql`
        DELETE FROM app.automation_project_bindings
        WHERE org_id = ${orgId} AND automation_name = ${name}
      `.catch((error: unknown) => {
        console.warn(
          '[itest] cleanup of the doors bindings:',
          error instanceof Error ? error.message : error,
        );
      });
      await sql`DELETE FROM app.projects WHERE id = ${projectId}`.catch(
        (error: unknown) => {
          console.warn(
            '[itest] cleanup of the doors project:',
            error instanceof Error ? error.message : error,
          );
        },
      );
    }
    await sql`DELETE FROM "team" WHERE "id" = ${teamId}`.catch(
      (error: unknown) => {
        console.warn(
          '[itest] cleanup of the doors team:',
          error instanceof Error ? error.message : error,
        );
      },
    );
    for (const written of [name, benchName]) {
      await deleteAutomationCascade(sql, {
        organizationId: orgId,
        name: written,
        origin: appOrigin(userId),
      }).catch((error: unknown) => {
        console.warn(
          `[itest] cleanup of ${written}:`,
          error instanceof Error ? error.message : error,
        );
      });
    }
    // The lanes after this one spend the same request, execution and bench
    // budgets.
    await sql`DELETE FROM app.rate_limits WHERE name = 'rest:api'`;
    await sql`DELETE FROM app.rate_limits WHERE name = 'rest:execute'`;
    await sql`DELETE FROM app.rate_limits WHERE name = 'automation:bench'`;
  }
}

/** The object under `value`, or null. */
function isRecordOf(value: unknown): Record<string, unknown> | null {
  const parsed = json.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Whether `value` is an object holding `key` equal to `expected`. */
function isRecordWith(value: unknown, key: string, expected: unknown): boolean {
  const object = isRecordOf(value);
  return object !== null && object[key] === expected;
}
