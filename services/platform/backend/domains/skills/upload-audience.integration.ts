/** Real sessions, staged ZIPs, files and Postgres: both upload doors keep
 * the skill library's owner/audience rules, including competing writers. */
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { serve } from '@hono/node-server';
import JSZip from 'jszip';
import postgres, { type Sql } from 'postgres';
import { z } from 'zod';

import { parseSkillMd } from '../../../lib/skills/parse.ts';
import { createApp } from '../../app.ts';
import type { Auth } from '../../auth/auth.ts';
import { writeSkillBundleFiles } from '../../core/skills/file_utils.ts';
import { resolvePostgresConnection } from '../../db/ssl.ts';
import {
  itestObjectStore,
  type RecordCheck,
  recordSkip,
} from '../../integration-lane-helpers.ts';
import { resolveObjectStore } from '../../lib/object-store.ts';
import { ensureDefaultObjectStore } from '../object_storage/bootstrap.ts';
import {
  skillWriterLockKey,
  withSkillWriterLock,
  withSkillWriterLocks,
} from './writer-lock.ts';

interface Actor {
  cookie: string;
  userId: string;
}

const uploadResult = z.looseObject({
  ok: z.boolean().optional(),
  error: z.string().optional(),
  status: z.string().optional(),
  skills: z
    .array(z.object({ slug: z.string(), action: z.string() }))
    .optional(),
});

export async function checkSkillUploadAudience(
  sql: Sql,
  base: string,
  ctx: Actor & { orgId: string },
  orgSlug: string,
  auth: Auth,
  signUpMember: (label: string, role: string) => Promise<Actor>,
  record: RecordCheck,
): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const store = itestObjectStore();
  if (!store) {
    recordSkip(
      record,
      'skill upload audience',
      'no ITEST_S3_ENDPOINT — staged ZIP lanes not exercised',
    );
    return;
  }
  // A filtered run may not have run checkFiles. Keep a configured store
  // intact so this lane does not repoint blobs earlier lanes still need.
  try {
    await resolveObjectStore(orgSlug);
  } catch {
    await ensureDefaultObjectStore(sql, {
      OBJECT_STORE_ENDPOINT: store.endpoint,
      OBJECT_STORE_BUCKET: `itest-skill-upload-${suffix}`,
      OBJECT_STORE_ACCESS_KEY: store.accessKeyId,
      OBJECT_STORE_SECRET_KEY: store.secretAccessKey,
    });
  }
  const slug = (name: string) => `itest-aud-${suffix}-${name}`;
  const developer = await signUpMember(`skill-dev-${suffix}`, 'developer');
  const member = await signUpMember(`skill-member-${suffix}`, 'member');
  const admin = await signUpMember(`skill-admin-${suffix}`, 'admin');
  const mine = randomUUID();
  const other = randomUUID();
  const foreign = randomUUID();
  const foreignOrg = randomUUID();
  await sql`
    INSERT INTO "organization" ("id", "name", "slug", "createdAt")
    VALUES (${foreignOrg}, 'Other upload tenant', ${`upload-other-${suffix}`}, ${new Date()})
  `;
  for (const [teamId, organizationId] of [
    [mine, ctx.orgId],
    [other, ctx.orgId],
    [foreign, foreignOrg],
  ] as const) {
    await sql`
      INSERT INTO "team" ("id", "name", "organizationId", "createdAt", "updatedAt")
      VALUES (${teamId}, 'Upload audience', ${organizationId}, ${new Date()}, ${new Date()})
    `;
  }
  for (const userId of [developer.userId, member.userId]) {
    await sql`
      INSERT INTO "teamMember" ("id", "teamId", "userId", "createdAt")
      VALUES (gen_random_uuid(), ${mine}, ${userId}, ${new Date()})
    `;
  }

  const md = (name: string, frontmatter = '', body = 'Original body.') =>
    `---\nname: ${name}\ndescription: Upload audience proof\n${frontmatter}---\n\n${body}\n`;
  const team = (id: string) => `visibility: team\nteams:\n  - ${id}\n`;
  const filePath = (name: string) =>
    path.join(
      process.env.TALE_CONFIG_DIR ?? '',
      orgSlug,
      'skills',
      name,
      'SKILL.md',
    );
  const onDisk = (name: string) =>
    readFile(filePath(name), 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
  const ownerOf = async (name: string) => {
    const text = await onDisk(name);
    return text === null
      ? undefined
      : parseSkillMd(text, 'SKILL.md').meta.owner;
  };
  const stage = async (
    actor: Actor,
    purpose: 'skill_bundle' | 'automation_bundle',
    files: Record<string, string>,
  ) => {
    const zip = new JSZip();
    for (const [name, content] of Object.entries(files))
      zip.file(name, content);
    const response = await fetch(
      `${base}/api/app/files/upload?purpose=${purpose}&orgId=${ctx.orgId}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/zip',
          cookie: actor.cookie,
          origin: base,
        },
        body: await zip.generateAsync({ type: 'blob' }),
      },
    );
    const body = z
      .object({ storageId: z.string() })
      .safeParse(await response.json());
    if (!body.success)
      throw new Error(`Could not stage ${purpose}: HTTP ${response.status}`);
    return body.data.storageId;
  };
  const post = async (actor: Actor, route: string, body: unknown) => {
    const response = await fetch(
      `${base}/api/app/${route}?orgId=${ctx.orgId}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: actor.cookie,
          origin: base,
        },
        body: JSON.stringify(body),
      },
    );
    const value = uploadResult.safeParse(
      await response.json().catch(() => null),
    );
    return { status: response.status, body: value.success ? value.data : null };
  };
  const skillUpload = async (actor: Actor, text: string, force = false) =>
    post(actor, 'skills/upload', {
      storageId: await stage(actor, 'skill_bundle', { 'SKILL.md': text }),
      force,
    });
  const packageFiles = (skills: Record<string, string>) => ({
    'workflow.yml': `version: 1\nname: ${slug('flow')}\nnodes:\n  - id: done\n    type: transform\n    input: {}\n    code: 'return 1;'\n`,
    'automation.yml': `name: Upload audience proof\nskills:\n${Object.keys(
      skills,
    )
      .map((name) => `  - ${name}`)
      .join('\n')}\n`,
    ...Object.fromEntries(
      Object.entries(skills).map(([name, text]) => [
        `skills/${name}/SKILL.md`,
        text,
      ]),
    ),
  });
  const packageUpload = async (
    actor: Actor,
    skills: Record<string, string>,
    overwriteSkills: string[] = [],
  ) =>
    post(actor, 'automations/upload', {
      storageId: await stage(actor, 'automation_bundle', packageFiles(skills)),
      overwriteSkills,
    });
  const check = (name: string, ok: boolean, detail: unknown) =>
    record(`skill upload audience: ${name}`, ok, JSON.stringify(detail));

  const memberSlug = slug('member');
  const memberCreated = await skillUpload(
    member,
    md(memberSlug, `owner: ${admin.userId}\n${team(mine)}`),
  );
  check(
    'a member uploads to their team as themselves',
    memberCreated.body?.ok === true &&
      (await ownerOf(memberSlug)) === member.userId,
    { ...memberCreated, owner: await ownerOf(memberSlug) },
  );
  const memberEdited = await skillUpload(
    member,
    md(memberSlug, team(mine), 'Member replacement.'),
    true,
  );
  check(
    'a member replaces their own bundle',
    memberEdited.body?.ok === true &&
      (await onDisk(memberSlug))?.includes('Member replacement.') === true,
    memberEdited,
  );

  for (const [label, teamId, expected, code] of [
    ['other', other, 403, 'TEAM_ACCESS_DENIED'],
    ['foreign', foreign, 400, 'TEAM_NOT_IN_ORG'],
    ['unknown', randomUUID(), 400, 'TEAM_NOT_IN_ORG'],
  ] as const) {
    const name = slug(`member-${label}`);
    const result = await skillUpload(member, md(name, team(teamId)));
    check(
      `member ZIP rejects ${label} team without files`,
      result.status === expected &&
        result.body?.error === code &&
        (await onDisk(name)) === null,
      result,
    );
  }
  const adminSlug = slug('admin');
  const adminCreated = await skillUpload(admin, md(adminSlug, team(other)));
  check(
    'an admin may assign another team in the same org',
    adminCreated.body?.ok === true &&
      (await ownerOf(adminSlug)) === admin.userId,
    adminCreated,
  );
  const deniedReplacement = await skillUpload(
    member,
    md(adminSlug, '', 'Stolen.'),
    true,
  );
  check(
    'a member cannot replace another owner’s shared bundle',
    deniedReplacement.status === 403 &&
      deniedReplacement.body?.error === 'SKILL_FORBIDDEN' &&
      !(await onDisk(adminSlug))?.includes('Stolen.'),
    deniedReplacement,
  );
  const adminReplacement = await skillUpload(
    admin,
    md(memberSlug, '', 'Admin replacement.'),
    true,
  );
  check(
    'an admin replacing a shared bundle preserves its owner',
    adminReplacement.body?.ok === true &&
      (await ownerOf(memberSlug)) === member.userId,
    adminReplacement,
  );

  const roleSlug = slug('role');
  const deniedPackage = await packageUpload(member, {
    [roleSlug]: md(roleSlug),
  });
  check(
    'a member cannot use the automation author door',
    deniedPackage.status === 403 && (await onDisk(roleSlug)) === null,
    deniedPackage,
  );

  const packageSlug = slug('package');
  const originalPack = {
    [packageSlug]: md(packageSlug, `owner: ${admin.userId}\n${team(mine)}`),
  };
  const installed = await packageUpload(developer, originalPack);
  const beforeRepeat = await stat(filePath(packageSlug));
  const firstBytes = await onDisk(packageSlug);
  const repeated = await packageUpload(developer, originalPack);
  const afterRepeat = await stat(filePath(packageSlug));
  check(
    'a developer’s package is attributed to them; normalized re-upload writes nothing',
    installed.body?.ok === true &&
      (await ownerOf(packageSlug)) === developer.userId &&
      repeated.body?.skills?.[0]?.action === 'unchanged' &&
      firstBytes === (await onDisk(packageSlug)) &&
      beforeRepeat.mtimeMs === afterRepeat.mtimeMs,
    { installed, repeated, owner: await ownerOf(packageSlug) },
  );
  const unconfirmed = await packageUpload(developer, {
    [packageSlug]: md(packageSlug, team(mine), 'Unconfirmed replacement.'),
    [slug('unconfirmed-new')]: md(slug('unconfirmed-new')),
  });
  check(
    'a differing owned skill needs confirmation before any carried skill is written',
    unconfirmed.body?.status === 'needs_confirm' &&
      firstBytes === (await onDisk(packageSlug)) &&
      (await onDisk(slug('unconfirmed-new'))) === null,
    unconfirmed,
  );

  for (const lane of ['zip', 'package'] as const) {
    const name = slug(`normalized-${lane}`);
    const text = md(
      name,
      `owner: ${developer.userId}\nvisibility: team\nteams: [" ${mine} ", "${mine}", " "]\n`,
    );
    const result =
      lane === 'zip'
        ? await skillUpload(developer, text)
        : await packageUpload(developer, { [name]: text });
    const stored = await onDisk(name);
    const teams =
      stored === null ? [] : parseSkillMd(stored, 'SKILL.md').meta.teams;
    check(
      `${lane} stores exactly the normalized teams it authorized`,
      result.body?.ok === true &&
        JSON.stringify(teams) === JSON.stringify([mine]),
      { result, teams },
    );
    const blank = slug(`blank-${lane}`);
    const blankText = md(blank, 'visibility: team\nteams: [" "]\n');
    const refused =
      lane === 'zip'
        ? await skillUpload(developer, blankText)
        : await packageUpload(developer, { [blank]: blankText });
    check(
      `${lane} refuses an empty audience after trimming`,
      refused.status === 400 &&
        refused.body?.error === 'INVALID_SKILL' &&
        (await onDisk(blank)) === null,
      refused,
    );
  }
  for (const [label, teamId, expected, code] of [
    ['other', other, 403, 'TEAM_ACCESS_DENIED'],
    ['foreign', foreign, 400, 'TEAM_NOT_IN_ORG'],
  ] as const) {
    const name = slug(`package-${label}`);
    const result = await packageUpload(developer, {
      [name]: md(name, team(teamId)),
    });
    check(
      `developer package rejects ${label} team with the skill door’s status`,
      result.status === expected &&
        result.body?.error === code &&
        (await onDisk(name)) === null,
      result,
    );
  }
  const allowedMixed = slug('mixed-a');
  const refusedMixed = slug('mixed-z');
  const mixed = await packageUpload(developer, {
    [allowedMixed]: md(allowedMixed, team(mine)),
    [refusedMixed]: md(refusedMixed, team(foreign)),
  });
  check(
    'a refused mixed package writes none of its skills',
    mixed.body?.error === 'TEAM_NOT_IN_ORG' &&
      (await onDisk(allowedMixed)) === null &&
      (await onDisk(refusedMixed)) === null,
    mixed,
  );

  const privateSlug = slug('private');
  const privatePack = await packageUpload(developer, {
    [privateSlug]: md(
      privateSlug,
      `visibility: private\nowner: ${developer.userId}\n`,
    ),
  });
  check(
    'a package cannot mint a private skill',
    privatePack.status === 400 &&
      privatePack.body?.error === 'CARRIED_SKILL_PRIVATE' &&
      (await onDisk(privateSlug)) === null,
    privatePack,
  );
  const stolenPack = await packageUpload(
    developer,
    { [adminSlug]: md(adminSlug, '', 'Stolen by package.') },
    [adminSlug],
  );
  check(
    'a developer cannot replace another owner through a package',
    stolenPack.body?.error === 'SKILL_CONFLICT_FORBIDDEN' &&
      !(await onDisk(adminSlug))?.includes('Stolen by package.'),
    stolenPack,
  );
  const replacedPack = await packageUpload(
    admin,
    {
      [packageSlug]: md(packageSlug, team(other), 'Admin package replacement.'),
    },
    [packageSlug],
  );
  check(
    'an admin’s package keeps the existing owner and can change to an org team',
    replacedPack.body?.ok === true &&
      (await ownerOf(packageSlug)) === developer.userId,
    replacedPack,
  );

  // Ownerless replacement is the established ZIP contract (different from
  // an in-place editor save): adoption by the uploader is deliberate.
  const ownerless = slug('ownerless');
  await withSkillWriterLock(sql, ctx.orgId, ownerless, () =>
    writeSkillBundleFiles(orgSlug, ownerless, [
      { path: 'SKILL.md', content: Buffer.from(md(ownerless)) },
    ]),
  );
  const adopted = await packageUpload(
    admin,
    { [ownerless]: md(ownerless, '', 'Adopted.') },
    [ownerless],
  );
  check(
    'an ownerless carried replacement adopts its uploader',
    adopted.body?.ok === true && (await ownerOf(ownerless)) === admin.userId,
    adopted,
  );

  // A real one-connection app pool exposes a reservation deadlock without
  // needing ten simultaneous writers: the lock and the audience queries
  // must use the same connection. Auth still verifies the real sessions.
  const singleZip = slug('single-zip');
  const singlePack = slug('single-pack');
  const stagedSingleZip = await stage(developer, 'skill_bundle', {
    'SKILL.md': md(singleZip, team(mine)),
  });
  const stagedSinglePack = await stage(
    developer,
    'automation_bundle',
    packageFiles({
      [singlePack]: md(singlePack, team(mine)),
    }),
  );
  const connection = resolvePostgresConnection(process.env.DATABASE_URL ?? '');
  const single = postgres(connection.url, { max: 1, ssl: connection.ssl });
  const limitedApp = createApp({ sql: single, auth });
  const limitedServer = serve({
    fetch: limitedApp.fetch,
    hostname: '127.0.0.1',
    port: 0,
  });
  if (!limitedServer.listening)
    await new Promise<void>((resolve) =>
      limitedServer.once('listening', resolve),
    );
  const address = limitedServer.address();
  if (address === null || typeof address === 'string')
    throw new Error('No one-connection test address');
  const limitedBase = `http://127.0.0.1:${address.port}`;
  const statuses: Array<number | 'timeout'> = [];
  try {
    for (const [method, route, body] of [
      ['POST', 'skills/upload', { storageId: stagedSingleZip }],
      ['POST', 'automations/upload', { storageId: stagedSinglePack }],
      [
        'PUT',
        `skills/${singleZip}`,
        {
          description: 'Single connection edit.',
          body: 'Edited.',
          visibility: 'team',
          teams: [mine],
        },
      ],
      ['DELETE', `skills/${singleZip}`, undefined],
    ] as const) {
      const response = fetch(
        `${limitedBase}/api/app/${route}?orgId=${ctx.orgId}`,
        {
          method,
          headers: {
            'content-type': 'application/json',
            cookie: developer.cookie,
            origin: base,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      );
      const status = await Promise.race([
        response.then((value) => value.status),
        sleep(3_000).then(() => 'timeout' as const),
      ]);
      statuses.push(status);
      if (status === 'timeout') break;
    }
    check(
      'ZIP, package, editor and deletion complete with one app database connection',
      statuses.length === 4 &&
        statuses.every((status) => status === 200) &&
        (await ownerOf(singlePack)) === developer.userId &&
        (await onDisk(singleZip)) === null,
      { statuses },
    );
  } finally {
    await single.end({ timeout: 0 });
    if ('closeAllConnections' in limitedServer)
      limitedServer.closeAllConnections();
    await new Promise<void>((resolve) => limitedServer.close(() => resolve()));
  }

  // Keeping an existing audience is not a new assignment, even after a
  // team was removed. Neither upload door should strand the owner.
  const staleZip = slug('stale-zip');
  const stalePack = slug('stale-pack');
  await skillUpload(member, md(staleZip, team(mine)));
  await packageUpload(developer, { [stalePack]: md(stalePack, team(mine)) });
  await sql`DELETE FROM "teamMember" WHERE "teamId" = ${mine}`;
  await sql`DELETE FROM "team" WHERE "id" = ${mine}`;
  const editedStaleZip = await skillUpload(
    member,
    md(staleZip, team(mine), 'Kept stale ZIP audience.'),
    true,
  );
  const editedStalePack = await packageUpload(
    developer,
    { [stalePack]: md(stalePack, team(mine), 'Kept stale package audience.') },
    [stalePack],
  );
  check(
    'owners can keep an unchanged deleted-team audience on either door',
    editedStaleZip.body?.ok === true && editedStalePack.body?.ok === true,
    { editedStaleZip, editedStalePack },
  );

  // A competing editor/ZIP writer owns the same PostgreSQL mutex. The
  // package must wait BEFORE planning; after the competing create lands,
  // it must decide ownership again rather than write its earlier snapshot.
  const raced = slug('race');
  const early = slug('race-early');
  const stagedRace = await stage(
    developer,
    'automation_bundle',
    packageFiles({
      [early]: md(early),
      [raced]: md(raced),
    }),
  );
  let release = () => {};
  let taken = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = new Promise<void>((resolve) => {
    taken = resolve;
  });
  const lock = sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${skillWriterLockKey(ctx.orgId, raced)}))`;
    taken();
    await gate;
  });
  await held;
  const racing = post(developer, 'automations/upload', {
    storageId: stagedRace,
    overwriteSkills: [raced],
  });
  let whileLocked: string;
  let prematureWrite: boolean;
  try {
    whileLocked = await Promise.race([
      racing.then((value) => `landed:${value.status}`),
      sleep(750).then(() => 'waiting'),
    ]);
    prematureWrite =
      (await onDisk(early)) !== null || (await onDisk(raced)) !== null;
    await writeSkillBundleFiles(orgSlug, raced, [
      {
        path: 'SKILL.md',
        content: Buffer.from(
          md(raced, `owner: ${admin.userId}\n`, 'Competing owner wins.'),
        ),
      },
    ]);
  } finally {
    release();
    await lock;
  }
  const racedResult = await racing;
  check(
    'a package waits for every writer lock, then rejects a newly owned conflict without partial writes',
    whileLocked === 'waiting' &&
      !prematureWrite &&
      racedResult.body?.error === 'SKILL_CONFLICT_FORBIDDEN' &&
      (await onDisk(early)) === null &&
      (await ownerOf(raced)) === admin.userId &&
      (await onDisk(raced))?.includes('Competing owner wins.') === true,
    {
      whileLocked,
      prematureWrite,
      racedResult,
      finalOwner: await ownerOf(raced),
    },
  );

  let active = 0;
  let maximum = 0;
  let completed = 0;
  const criticalSection = async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await sleep(30);
    active -= 1;
    completed += 1;
  };
  await Promise.all([
    withSkillWriterLocks(
      sql,
      ctx.orgId,
      [raced, early, raced],
      criticalSection,
    ),
    withSkillWriterLocks(sql, ctx.orgId, [early, raced], criticalSection),
  ]);
  check(
    'overlapping package locks serialize in either order without a deadlock',
    completed === 2 && maximum === 1,
    { completed, maximum },
  );
}
