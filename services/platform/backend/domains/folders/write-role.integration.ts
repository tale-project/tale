/**
 * Real HTTP + Postgres proof that the hub folder doors take the documents
 * write role (#3592); mounted by backend/integration-check.ts.
 *
 * A read-only `member` of a team could create and rename hub folders and —
 * the harm — re-team one: `POST /api/app/folders/:id/teams` with no teams
 * rewrote every descendant folder and document to organization-wide, so a
 * member published documents they may not change themselves to people
 * outside the team. This lane drives the real folder routes (session,
 * membership, serializable transaction) in two organizations of its own,
 * so the suite's shared organization and its counts stay as other lanes
 * expect them: the member is refused on every door and nothing moves, an
 * editor's writes land with their cascade, the team and tenant boundaries
 * hold for an editor too, and a project folder still answers to the
 * project matrix.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { canSeeAudience } from '../../core/lib/audience.ts';
import { signUpUser } from '../../integration-lane-helpers.ts';

const answerSchema = z.looseObject({
  error: z.string().optional(),
  folderId: z.string().optional(),
  ok: z.boolean().optional(),
  folders: z.array(z.looseObject({ id: z.string() })).optional(),
});

interface Answer {
  status: number;
  code: string;
  folderId: string;
  ok: boolean;
  listed: string[];
}

interface FolderState {
  name: string;
  teamId: string | null;
  teamTags: string[];
}

export async function checkHubFolderWriteRole(
  sql: Sql,
  base: string,
  record: (name: string, ok: boolean, detail: string) => void,
): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const now = Date.now();
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  for (const [id, label] of [
    [orgId, 'folders'],
    [otherOrgId, 'folders-other'],
  ] as const) {
    await sql`
      INSERT INTO "organization" ("id", "name", "slug", "createdAt")
      VALUES (${id}, ${`Folder write role ${label} ${suffix}`},
              ${`itest-${label}-${suffix}`}, ${new Date()})
    `;
  }
  const teamA = randomUUID();
  const teamB = randomUUID();
  for (const [id, name] of [
    [teamA, 'Folder team A'],
    [teamB, 'Folder team B'],
  ] as const) {
    await sql`
      INSERT INTO "team" ("id", "name", "organizationId", "createdAt")
      VALUES (${id}, ${name}, ${orgId}, ${new Date()})
    `;
  }

  // The people: a read-only member and an editor of team A, an editor of
  // team B only. Nobody here belongs to the other organization.
  const person = async (
    label: string,
    role: string,
    teamId: string,
  ): Promise<{ cookie: string; userId: string }> => {
    const user = await signUpUser(base, `folder-${label}-${suffix}`);
    await sql`
      INSERT INTO "member" ("id", "organizationId", "userId", "role",
                            "createdAt")
      VALUES (${randomUUID()}, ${orgId}, ${user.userId}, ${role},
              ${new Date()})
    `;
    await sql`
      INSERT INTO "teamMember" ("id", "teamId", "userId", "createdAt")
      VALUES (${randomUUID()}, ${teamId}, ${user.userId}, ${new Date()})
    `;
    return user;
  };
  const member = await person('member', 'member', teamA);
  const editor = await person('editor', 'editor', teamA);
  const outsider = await person('outsider', 'editor', teamB);
  if ([member, editor, outsider].some((user) => user.userId === '')) {
    record(
      'hub folder write role: the lane signs up its people',
      false,
      `user ids member=${member.userId || '-'} editor=${editor.userId || '-'} outsider=${outsider.userId || '-'}`,
    );
    return;
  }

  // The fixture #3592 reproduced: a team-A root folder with a nested folder
  // and a document inside it; another organization's folder; project
  // folders of an organization-wide project and of a team-B one.
  const ids = {
    restricted: randomUUID(),
    child: randomUUID(),
    foreign: randomUUID(),
    projectFolder: randomUUID(),
    teamBProjectFolder: randomUUID(),
  };
  const documentId = randomUUID();
  const project = randomUUID();
  const teamBProject = randomUUID();
  const insertFolder = async (
    id: string,
    org: string,
    name: string,
    place: { parentId?: string; teamTags?: string[]; projectId?: string },
  ): Promise<void> => {
    const teamTags = place.teamTags ?? [];
    await sql`
      INSERT INTO app.folders (
        id, org_id, name, parent_id, team_id, team_tags, project_id,
        created_by, created_at_ms
      ) VALUES (
        ${id}, ${org}, ${name}, ${place.parentId ?? null},
        ${teamTags[0] ?? null}, ${teamTags}, ${place.projectId ?? null},
        ${editor.userId}, ${now}
      )
    `;
  };
  await insertFolder(ids.restricted, orgId, 'Restricted', {
    teamTags: [teamA],
  });
  await insertFolder(ids.child, orgId, 'Child', {
    parentId: ids.restricted,
    teamTags: [teamA],
  });
  await insertFolder(ids.foreign, otherOrgId, 'Other org', {});
  await sql`
    INSERT INTO app.documents (
      id, org_id, title, content, file_ref, extension, source_provider,
      folder_id, team_id, team_tags, created_by, created_at_ms, updated_at_ms
    ) VALUES (
      ${documentId}, ${orgId}, 'Restricted memo.txt', 'synthetic fixture',
      ${`s3:itest/folder-write-role/${suffix}`}, 'txt', 'upload',
      ${ids.child}, ${teamA}, ${[teamA]}, ${editor.userId}, ${now}, ${now}
    )
  `;
  for (const [id, teamIds] of [
    [project, []],
    [teamBProject, [teamB]],
  ] as const) {
    await sql`
      INSERT INTO app.projects (
        id, org_id, name, team_ids, created_by, created_at_ms, updated_at_ms
      ) VALUES (
        ${id}, ${orgId}, 'Folder write role project', ${[...teamIds]}::text[],
        ${editor.userId}, ${now}, ${now}
      )
    `;
  }
  await insertFolder(ids.projectFolder, orgId, 'Project folder', {
    projectId: project,
  });
  await insertFolder(ids.teamBProjectFolder, orgId, 'Team B project folder', {
    projectId: teamBProject,
  });

  const call = async (
    who: { cookie: string },
    method: 'GET' | 'POST',
    route: string,
    body?: unknown,
    org = orgId,
  ): Promise<Answer> => {
    const response = await fetch(
      `${base}/api/app/folders${route}${route.includes('?') ? '&' : '?'}orgId=${org}`,
      {
        method,
        headers: {
          'content-type': 'application/json',
          cookie: who.cookie,
          origin: base,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
    );
    const parsed = answerSchema.safeParse(
      await response.json().catch(() => null),
    );
    const data = parsed.success ? parsed.data : {};
    return {
      status: response.status,
      code: data.error ?? '',
      folderId: data.folderId ?? '',
      ok: data.ok === true,
      listed: (data.folders ?? []).map((folder) => folder.id),
    };
  };
  const said = (answer: Answer): string => `${answer.status}/${answer.code}`;
  const folderState = async (id: string): Promise<FolderState | null> => {
    const rows = await sql<FolderState[]>`
      SELECT name, team_id AS "teamId", team_tags AS "teamTags"
      FROM app.folders WHERE id = ${id}
    `;
    return rows[0] ?? null;
  };
  const documentAudience = async (): Promise<{
    teamId: string | null;
    teamTags: string[];
  } | null> => {
    const rows = await sql<{ teamId: string | null; teamTags: string[] }[]>`
      SELECT team_id AS "teamId", team_tags AS "teamTags"
      FROM app.documents WHERE id = ${documentId}
    `;
    return rows[0] ?? null;
  };
  const folderCount = async (org: string): Promise<number> => {
    const rows = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.folders WHERE org_id = ${org}
    `;
    return Number(rows[0]?.count ?? '-1');
  };
  const onlyTeam = (
    state: { teamId: string | null; teamTags: string[] } | null,
    teamId: string,
  ): boolean =>
    state !== null &&
    state.teamId === teamId &&
    state.teamTags.length === 1 &&
    state.teamTags[0] === teamId;
  const orgWide = (
    state: { teamId: string | null; teamTags: string[] } | null,
  ): boolean =>
    state !== null && state.teamId === null && state.teamTags.length === 0;
  /** Someone in the organization who is in neither team. */
  const nobody = { role: 'member', teamIds: [] };

  // ---- a member: refused on every hub folder write, nothing moves --------
  const foldersBefore = await folderCount(orgId);
  const memberCreate = await call(member, 'POST', '', { name: 'Member root' });
  const memberCreateInside = await call(member, 'POST', '', {
    name: 'Member child',
    parentId: ids.restricted,
  });
  const memberCreateTeam = await call(member, 'POST', '', {
    name: 'Member team folder',
    teamIds: [teamA],
  });
  const memberRename = await call(member, 'POST', `/${ids.restricted}/rename`, {
    name: 'Member renamed',
  });
  const memberPublish = await call(member, 'POST', `/${ids.restricted}/teams`, {
    teamIds: [],
  });
  // Reading stays open: the member still lists the team folder.
  const memberList = await call(member, 'GET', '?parentId=');
  const memberRefusals = [
    memberCreate,
    memberCreateInside,
    memberCreateTeam,
    memberRename,
    memberPublish,
  ];
  const restrictedAfterMember = await folderState(ids.restricted);
  const childAfterMember = await folderState(ids.child);
  const documentAfterMember = await documentAudience();
  const foldersAfterMember = await folderCount(orgId);
  record(
    'hub folder write role: a member is refused creating, renaming and re-teaming hub folders, and nothing moves',
    memberRefusals.every(
      (answer) => answer.status === 403 && answer.code === 'RBAC_FORBIDDEN',
    ) &&
      memberList.status === 200 &&
      memberList.listed.includes(ids.restricted) &&
      foldersAfterMember === foldersBefore &&
      restrictedAfterMember?.name === 'Restricted' &&
      onlyTeam(restrictedAfterMember, teamA) &&
      onlyTeam(childAfterMember, teamA) &&
      onlyTeam(documentAfterMember, teamA) &&
      !canSeeAudience({ teamIds: documentAfterMember?.teamTags ?? [] }, nobody),
    `create/create-inside/create-with-team/rename/publish → ${memberRefusals.map(said).join(' ')} (want all 403/RBAC_FORBIDDEN); list → ${memberList.status} listsRestricted=${memberList.listed.includes(ids.restricted)} (want 200 true); folders ${foldersBefore} → ${foldersAfterMember}; restricted=${JSON.stringify(restrictedAfterMember)} child=${JSON.stringify(childAfterMember)} document=${JSON.stringify(documentAfterMember)} (want name Restricted, all team A only)`,
  );

  // ---- an editor: the same writes land, the re-team cascades -------------
  const editorCreate = await call(editor, 'POST', '', { name: 'Editor root' });
  const editorCreateInside = await call(editor, 'POST', '', {
    name: 'Editor child',
    parentId: ids.restricted,
  });
  const createdRoot = await folderState(editorCreate.folderId);
  const createdInside = await folderState(editorCreateInside.folderId);
  const editorRename = await call(editor, 'POST', `/${ids.restricted}/rename`, {
    name: 'Restricted renamed',
  });
  const editorPublish = await call(editor, 'POST', `/${ids.restricted}/teams`, {
    teamIds: [],
  });
  const restrictedPublished = await folderState(ids.restricted);
  const childPublished = await folderState(ids.child);
  const insidePublished = await folderState(editorCreateInside.folderId);
  const documentPublished = await documentAudience();
  // …and back: the editor narrows the subtree to team A again.
  const editorNarrow = await call(editor, 'POST', `/${ids.restricted}/teams`, {
    teamIds: [teamA],
  });
  const documentNarrowed = await documentAudience();
  const childNarrowed = await folderState(ids.child);
  record(
    'hub folder write role: an editor creates, renames and re-teams hub folders, the cascade reaching the descendant documents',
    editorCreate.status === 200 &&
      orgWide(createdRoot) &&
      createdRoot?.name === 'Editor root' &&
      editorCreateInside.status === 200 &&
      onlyTeam(createdInside, teamA) &&
      editorRename.status === 200 &&
      editorRename.ok &&
      editorPublish.status === 200 &&
      editorPublish.ok &&
      restrictedPublished?.name === 'Restricted renamed' &&
      orgWide(restrictedPublished) &&
      orgWide(childPublished) &&
      orgWide(insidePublished) &&
      orgWide(documentPublished) &&
      canSeeAudience({ teamIds: documentPublished?.teamTags ?? [] }, nobody) &&
      editorNarrow.status === 200 &&
      onlyTeam(childNarrowed, teamA) &&
      onlyTeam(documentNarrowed, teamA),
    `create → ${said(editorCreate)} ${JSON.stringify(createdRoot)} (want 200, org-wide), create inside → ${said(editorCreateInside)} ${JSON.stringify(createdInside)} (want 200, team A), rename → ${said(editorRename)}, publish → ${said(editorPublish)} (want 200/200); after publish restricted=${JSON.stringify(restrictedPublished)} child=${JSON.stringify(childPublished)} inside=${JSON.stringify(insidePublished)} document=${JSON.stringify(documentPublished)} (want all org-wide); narrow → ${said(editorNarrow)} child=${JSON.stringify(childNarrowed)} document=${JSON.stringify(documentNarrowed)} (want team A)`,
  );

  // ---- the team boundary holds for an editor -----------------------------
  const outsiderRename = await call(
    outsider,
    'POST',
    `/${ids.restricted}/rename`,
    { name: 'Outsider renamed' },
  );
  const outsiderPublish = await call(
    outsider,
    'POST',
    `/${ids.restricted}/teams`,
    { teamIds: [] },
  );
  const outsiderCreateInside = await call(outsider, 'POST', '', {
    name: 'Outsider child',
    parentId: ids.restricted,
  });
  // An editor of team A files only into their own teams.
  const editorForeignTeam = await call(
    editor,
    'POST',
    `/${ids.restricted}/teams`,
    { teamIds: [teamB] },
  );
  const restrictedAfterBoundary = await folderState(ids.restricted);
  const documentAfterBoundary = await documentAudience();
  record(
    'hub folder write role: an editor cannot reach a team folder outside their teams, nor file into a team they are not in',
    outsiderRename.status === 403 &&
      outsiderRename.code === 'FOLDER_NOT_ACCESSIBLE' &&
      outsiderPublish.status === 403 &&
      outsiderPublish.code === 'FOLDER_ACCESS_DENIED' &&
      outsiderCreateInside.status === 403 &&
      outsiderCreateInside.code === 'FOLDER_PARENT_NOT_ACCESSIBLE' &&
      editorForeignTeam.status === 403 &&
      editorForeignTeam.code === 'FOLDER_TEAM_FORBIDDEN' &&
      restrictedAfterBoundary?.name === 'Restricted renamed' &&
      onlyTeam(restrictedAfterBoundary, teamA) &&
      onlyTeam(documentAfterBoundary, teamA),
    `outsider rename/publish/create inside → ${said(outsiderRename)} ${said(outsiderPublish)} ${said(outsiderCreateInside)} (want 403/FOLDER_NOT_ACCESSIBLE 403/FOLDER_ACCESS_DENIED 403/FOLDER_PARENT_NOT_ACCESSIBLE), editor into team B → ${said(editorForeignTeam)} (want 403/FOLDER_TEAM_FORBIDDEN); restricted=${JSON.stringify(restrictedAfterBoundary)} document=${JSON.stringify(documentAfterBoundary)} (want renamed, team A)`,
  );

  // ---- the tenant boundary: another organization's folder ----------------
  const otherBefore = await folderCount(otherOrgId);
  const tenantProbes: { who: string; answers: Answer[] }[] = [];
  for (const [who, caller] of [
    ['member', member],
    ['editor', editor],
  ] as const) {
    tenantProbes.push({
      who,
      answers: [
        await call(caller, 'POST', `/${ids.foreign}/rename`, {
          name: 'Taken over',
        }),
        await call(caller, 'POST', `/${ids.foreign}/teams`, {
          teamIds: [teamA],
        }),
        await call(caller, 'POST', '', {
          name: 'Planted',
          parentId: ids.foreign,
        }),
      ],
    });
  }
  // Naming the other organization itself: the editor is no member there.
  const editorInOtherOrg = await call(
    editor,
    'POST',
    '',
    { name: 'Planted' },
    otherOrgId,
  );
  const foreignAfter = await folderState(ids.foreign);
  const otherAfter = await folderCount(otherOrgId);
  const tenantCodes = tenantProbes.map((probe) =>
    probe.answers.map((answer) => answer.code).join(','),
  );
  record(
    'hub folder write role: another organization’s folder is not found, whatever the role, and stays as it was',
    tenantCodes.every(
      (codes) =>
        codes === 'FOLDER_NOT_FOUND,FOLDER_NOT_FOUND,FOLDER_PARENT_NOT_FOUND',
    ) &&
      tenantProbes.every((probe) =>
        probe.answers.every((answer) => answer.status === 404),
      ) &&
      editorInOtherOrg.status === 403 &&
      editorInOtherOrg.code === 'ORG_FORBIDDEN' &&
      foreignAfter?.name === 'Other org' &&
      orgWide(foreignAfter) &&
      otherAfter === otherBefore,
    `${tenantProbes.map((probe) => `${probe.who} rename/teams/create inside → ${probe.answers.map(said).join(' ')}`).join('; ')} (want 404/FOLDER_NOT_FOUND 404/FOLDER_NOT_FOUND 404/FOLDER_PARENT_NOT_FOUND); editor naming the other org → ${said(editorInOtherOrg)} (want 403/ORG_FORBIDDEN); foreign=${JSON.stringify(foreignAfter)} folders ${otherBefore} → ${otherAfter}`,
  );

  // ---- a project folder keeps the project matrix -------------------------
  const memberProjectCreate = await call(member, 'POST', '', {
    name: 'Member project folder',
    projectId: project,
  });
  const memberProjectRename = await call(
    member,
    'POST',
    `/${ids.projectFolder}/rename`,
    { name: 'Member renamed' },
  );
  const memberHiddenCreate = await call(member, 'POST', '', {
    name: 'Member hidden project folder',
    parentId: ids.teamBProjectFolder,
  });
  const memberHiddenRename = await call(
    member,
    'POST',
    `/${ids.teamBProjectFolder}/rename`,
    { name: 'Member renamed' },
  );
  const memberProjectTeams = await call(
    member,
    'POST',
    `/${ids.projectFolder}/teams`,
    { teamIds: [] },
  );
  const editorProjectCreate = await call(editor, 'POST', '', {
    name: 'Editor project folder',
    projectId: project,
  });
  const editorProjectRename = await call(
    editor,
    'POST',
    `/${ids.projectFolder}/rename`,
    { name: 'Project folder renamed' },
  );
  const projectFolderAfter = await folderState(ids.projectFolder);
  const hiddenAfter = await folderState(ids.teamBProjectFolder);
  record(
    'hub folder write role: a project folder keeps the project matrix (member refused as before, editor writes)',
    memberProjectCreate.status === 403 &&
      memberProjectCreate.code === 'RBAC_FORBIDDEN' &&
      memberProjectRename.status === 403 &&
      memberProjectRename.code === 'RBAC_FORBIDDEN' &&
      memberHiddenCreate.status === 403 &&
      memberHiddenCreate.code === 'PROJECT_FORBIDDEN' &&
      memberHiddenRename.status === 403 &&
      memberHiddenRename.code === 'PROJECT_FORBIDDEN' &&
      memberProjectTeams.status === 400 &&
      memberProjectTeams.code === 'FOLDER_SCOPE_CONFLICT' &&
      editorProjectCreate.status === 200 &&
      editorProjectCreate.folderId !== '' &&
      editorProjectRename.status === 200 &&
      projectFolderAfter?.name === 'Project folder renamed' &&
      hiddenAfter?.name === 'Team B project folder',
    `member create/rename in a readable project → ${said(memberProjectCreate)} ${said(memberProjectRename)} (want 403/RBAC_FORBIDDEN), in a team-B project → ${said(memberHiddenCreate)} ${said(memberHiddenRename)} (want 403/PROJECT_FORBIDDEN), teams on a project folder → ${said(memberProjectTeams)} (want 400/FOLDER_SCOPE_CONFLICT); editor create/rename → ${said(editorProjectCreate)} ${said(editorProjectRename)} (want 200/200); names ${projectFolderAfter?.name ?? '-'} / ${hiddenAfter?.name ?? '-'}`,
  );
}
