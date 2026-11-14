/** Real HTTP + Postgres proof of who answers in a project chat and of the
 * changes a chat proposes (migrations 0236 and 0237); mounted by
 * backend/integration-check.ts.
 *
 * - a project's new chats start with its default chat agent — the first
 *   agent created until an editor chooses another — and a chat's owner
 *   switches among the project's own agents only (`CHAT_AGENT_INVALID`);
 * - the project's choice is saved against the value the page read
 *   (`PROJECT_CHAT_AGENT_STALE`) and names only the project's own agents;
 * - deleting an agent clears every chat that answered as it, and the
 *   project's choice of it;
 * - a proposal changes nothing until its owner applies it; the apply
 *   writes through the projects service once, audited as made from the
 *   chat; an agent changed since is refused as stale and left as it is; a
 *   dismissed proposal stays dismissed; nobody else can decide it, and a
 *   Member is offered no settings tool; a proposal lives and dies with its
 *   conversation.
 *
 * `ctx` owns an organization of its own, so the provider the lane seeds
 * and everything it makes stay out of the suite's organization.
 */
import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';
import { z } from 'zod';

import { signUpUser } from '../../integration-lane-helpers.ts';
import { chatSettingsTools } from './proposals.ts';

type Recorder = (name: string, ok: boolean, detail: string) => void;

const projectCreatedSchema = z.object({ projectId: z.string() });
const agentCreatedSchema = z.object({ agentId: z.string() });
const threadCreatedSchema = z.object({ id: z.string() });
const okSchema = z.object({ ok: z.boolean() });
const codeSchema = z.looseObject({
  error: z.string().optional(),
  code: z.string().optional(),
});
const chatAgentsSchema = z.looseObject({
  chatAgent: z.looseObject({
    kind: z.string(),
    agentId: z.string().optional(),
  }),
  agents: z.array(z.looseObject({ id: z.string(), name: z.string() })),
});
const proposedSchema = z.looseObject({
  status: z.literal('ok'),
  proposalId: z.string(),
});
const decidedSchema = z.object({
  proposal: z.looseObject({
    id: z.string(),
    status: z.string(),
    failure: z.looseObject({ code: z.string(), reason: z.string() }).optional(),
  }),
});

export async function checkChatProjectAgents(
  sql: Sql,
  base: string,
  ctx: { cookie: string; orgId: string; userId: string },
  record: Recorder,
  seedAgentProvider: () => Promise<{ cleanup: () => Promise<void> }>,
): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const { orgId } = ctx;
  const door = (
    method: 'GET' | 'POST' | 'DELETE',
    route: string,
    payload?: unknown,
    cookie = ctx.cookie,
  ): Promise<Response> =>
    fetch(`${base}/api/app${route}?orgId=${orgId}`, {
      method,
      headers: { 'content-type': 'application/json', cookie, origin: base },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    });
  const codeOf = async (response: Response): Promise<string> => {
    const parsed = codeSchema.safeParse(
      await response.json().catch(() => null),
    );
    return parsed.success ? (parsed.data.error ?? parsed.data.code ?? '') : '';
  };
  const createProject = async (name: string): Promise<string> =>
    projectCreatedSchema.parse(
      await (await door('POST', '/projects', { name })).json(),
    ).projectId;
  const createAgent = async (
    projectId: string,
    name: string,
  ): Promise<string> => {
    const response = await door('POST', `/projects/${projectId}/agents`, {
      name,
      harness: 'claude-code',
      model: 'itest-agent-model',
      modelProvider: 'itestagent',
      skills: [],
      connectors: [],
    });
    if (response.status !== 200) {
      throw new Error(
        `agent ${name}: HTTP ${response.status} ${await response.text()}`,
      );
    }
    return agentCreatedSchema.parse(await response.json()).agentId;
  };
  const createChat = (payload: Record<string, unknown>): Promise<Response> =>
    door('POST', '/chat/threads', { kind: 'chat', ...payload });
  const chatAgentOf = async (threadId: string): Promise<string | null> => {
    const rows = await sql<{ chatAgentId: string | null }[]>`
      SELECT chat_agent_id AS "chatAgentId" FROM app.thread_metadata
      WHERE thread_id = ${threadId}
    `;
    return rows[0]?.chatAgentId ?? null;
  };
  const projectDefaultOf = async (
    projectId: string,
  ): Promise<string | null> => {
    const rows = await sql<{ agentId: string | null }[]>`
      SELECT default_chat_agent_id AS "agentId" FROM app.projects
      WHERE id = ${projectId}
    `;
    return rows[0]?.agentId ?? null;
  };

  // The provider file goes in once the new organization's scaffold has
  // settled (`seedItestAgentProvider` waits for it), or the scaffold would
  // empty the directory it was written to.
  const provider = await seedAgentProvider();
  try {
    const projectId = await createProject(`Chat agents ${suffix}`);
    const otherProjectId = await createProject(`Other agents ${suffix}`);
    const alpha = await createAgent(projectId, `Alpha ${suffix}`);
    const beta = await createAgent(projectId, `Beta ${suffix}`);
    const foreign = await createAgent(otherProjectId, `Foreign ${suffix}`);

    // ---- The project's default chat agent ------------------------------
    const read = chatAgentsSchema.safeParse(
      await (await door('GET', `/projects/${projectId}/chat-agents`)).json(),
    );
    const firstChat = threadCreatedSchema.parse(
      await (await createChat({ projectId })).json(),
    ).id;
    const chosen = await door('POST', `/projects/${projectId}/chat-agent`, {
      chatAgent: { kind: 'agent', agentId: beta },
      expected: { kind: 'first' },
    });
    const stale = await door('POST', `/projects/${projectId}/chat-agent`, {
      chatAgent: { kind: 'assistant' },
      expected: { kind: 'first' },
    });
    const staleCode = await codeOf(stale);
    const notOwn = await door('POST', `/projects/${projectId}/chat-agent`, {
      chatAgent: { kind: 'agent', agentId: foreign },
      expected: { kind: 'agent', agentId: beta },
    });
    const notOwnCode = await codeOf(notOwn);
    const secondChat = threadCreatedSchema.parse(
      await (await createChat({ projectId })).json(),
    ).id;
    record(
      'chat agents: a project chat starts with the first agent created, then with the default an editor saved against what the page read, among the project’s own agents only',
      read.success &&
        read.data.chatAgent.kind === 'first' &&
        read.data.agents.map((agent) => agent.id).join() ===
          [alpha, beta].join() &&
        (await chatAgentOf(firstChat)) === alpha &&
        chosen.status === 200 &&
        (await projectDefaultOf(projectId)) === beta &&
        stale.status === 409 &&
        staleCode === 'PROJECT_CHAT_AGENT_STALE' &&
        notOwn.status === 400 &&
        notOwnCode === 'PROJECT_CHAT_AGENT_INVALID' &&
        (await chatAgentOf(secondChat)) === beta,
      `read=${read.success ? `${read.data.chatAgent.kind}/${read.data.agents.length}` : 'ERR'}, first chat=${(await chatAgentOf(firstChat)) === alpha ? 'alpha' : 'other'}, save=${chosen.status}, stale=${stale.status}/${staleCode}, foreign=${notOwn.status}/${notOwnCode}, second chat=${(await chatAgentOf(secondChat)) === beta ? 'beta' : 'other'}`,
    );

    // ---- A chat's owner chooses who answers -----------------------------
    const pickedAtStart = threadCreatedSchema.safeParse(
      await (await createChat({ projectId, chatAgentId: alpha })).json(),
    );
    const assistantAtStart = threadCreatedSchema.safeParse(
      await (await createChat({ projectId, chatAgentId: null })).json(),
    );
    const foreignAtStart = await createChat({
      projectId,
      chatAgentId: foreign,
    });
    const foreignAtStartCode = await codeOf(foreignAtStart);
    const switched = await door('POST', `/chat/threads/${secondChat}/agent`, {
      agentId: alpha,
    });
    const switchedForeign = await door(
      'POST',
      `/chat/threads/${secondChat}/agent`,
      { agentId: foreign },
    );
    const switchedForeignCode = await codeOf(switchedForeign);
    const outsider = await signUpUser(base, `chat-agents-${suffix}`);
    await sql`
      INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
      VALUES (${randomUUID()}, ${orgId}, ${outsider.userId}, 'member', ${new Date()})
    `;
    // Another person's switch is a no-op: the chat is not theirs to change.
    const switchedByOther = okSchema.safeParse(
      await (
        await door(
          'POST',
          `/chat/threads/${secondChat}/agent`,
          { agentId: beta },
          outsider.cookie,
        )
      ).json(),
    );
    record(
      'chat agents: the owner picks one of the project’s own agents, or the assistant, at the start and later; another project’s agent and another person are refused',
      pickedAtStart.success &&
        (await chatAgentOf(pickedAtStart.data.id)) === alpha &&
        assistantAtStart.success &&
        (await chatAgentOf(assistantAtStart.data.id)) === null &&
        foreignAtStart.status === 400 &&
        foreignAtStartCode === 'CHAT_AGENT_INVALID' &&
        switched.status === 200 &&
        switchedForeign.status === 400 &&
        switchedForeignCode === 'CHAT_AGENT_INVALID' &&
        switchedByOther.success &&
        !switchedByOther.data.ok &&
        (await chatAgentOf(secondChat)) === alpha,
      `start alpha=${pickedAtStart.success}, start assistant=${assistantAtStart.success}, start foreign=${foreignAtStart.status}/${foreignAtStartCode}, switch=${switched.status}, switch foreign=${switchedForeign.status}/${switchedForeignCode}, other person ok=${switchedByOther.success ? switchedByOther.data.ok : 'ERR'}`,
    );

    // ---- Proposals --------------------------------------------------------
    // The second chat is filed in the project: its tools reach it alone.
    const settings = await chatSettingsTools(sql, {
      organizationId: orgId,
      userId: ctx.userId,
      rootThreadId: secondChat,
      projectId,
    });
    const memberSettings = await chatSettingsTools(sql, {
      organizationId: orgId,
      userId: outsider.userId,
      rootThreadId: secondChat,
      projectId,
    });
    if (settings === undefined) {
      record(
        'chat proposals: the owner is offered the settings tools',
        false,
        'chatSettingsTools answered none for the suite owner',
      );
      return;
    }
    const propose = async (input: Record<string, unknown>) =>
      proposedSchema.safeParse(
        await settings.executor.execute({
          id: `call-${randomUUID()}`,
          name: 'propose_project_settings',
          input,
        }),
      );
    const instructionsOf = async (agentId: string) =>
      (
        await sql<{ instructions: string | null; name: string }[]>`
          SELECT instructions, name FROM app.project_agents WHERE id = ${agentId}
        `
      )[0];
    const decide = async (
      proposalId: string,
      decision: 'apply' | 'dismiss',
      cookie = ctx.cookie,
    ) => {
      const response = await door(
        'POST',
        `/chat/proposals/${proposalId}/${decision}`,
        undefined,
        cookie,
      );
      return {
        status: response.status,
        body: decidedSchema.safeParse(await response.json().catch(() => null)),
      };
    };

    const instructions = `Answer in short sentences. ${suffix}`;
    const proposal = await propose({
      change: 'update_agent',
      project: projectId,
      agent: alpha,
      instructions,
    });
    const untouched = await instructionsOf(alpha);
    const byOther = proposal.success
      ? await decide(proposal.data.proposalId, 'apply', outsider.cookie)
      : null;
    const applied = proposal.success
      ? await decide(proposal.data.proposalId, 'apply')
      : null;
    const again = proposal.success
      ? await decide(proposal.data.proposalId, 'apply')
      : null;
    const changed = await instructionsOf(alpha);
    const audits = proposal.success
      ? await sql<{ count: number }[]>`
          SELECT count(*)::int AS count FROM app.audit_logs
          WHERE org_id = ${orgId} AND resource_id = ${projectId}
            AND metadata ->> 'via' = 'chat'
            AND metadata ->> 'proposalId' = ${proposal.data.proposalId}
            AND metadata ->> 'threadId' = ${secondChat}
        `
      : [];
    record(
      'chat proposals: nothing changes until the owner applies; the apply writes once, audited as made from the chat; another person cannot decide it and a Member is offered no settings tool',
      proposal.success &&
        untouched?.instructions !== instructions &&
        byOther?.status === 404 &&
        applied?.status === 200 &&
        applied.body.success &&
        applied.body.data.proposal.status === 'applied' &&
        again?.status === 200 &&
        again.body.success &&
        again.body.data.proposal.status === 'applied' &&
        changed?.instructions === instructions &&
        (audits[0]?.count ?? 0) === 1 &&
        memberSettings === undefined,
      `proposed=${proposal.success}, before apply=${untouched?.instructions === instructions ? 'CHANGED' : 'unchanged'}, other person=${byOther?.status}, apply=${applied?.status}/${applied?.body.success ? applied.body.data.proposal.status : 'ERR'}, again=${again?.body.success ? again.body.data.proposal.status : 'ERR'}, after=${changed?.instructions === instructions ? 'changed' : 'NOT changed'}, audit rows=${audits[0]?.count ?? 0}, member tools=${memberSettings === undefined ? 'none' : 'OFFERED'}`,
    );

    // A chat filed in a project reaches that project alone.
    const elsewhere = z.looseObject({ status: z.string() }).safeParse(
      await settings.executor.execute({
        id: `call-${randomUUID()}`,
        name: 'propose_project_settings',
        input: {
          change: 'update_agent',
          project: otherProjectId,
          agent: foreign,
          name: `Foreign renamed ${suffix}`,
        },
      }),
    );
    const listedHere = z
      .looseObject({
        projects: z.array(z.looseObject({ id: z.string() })),
      })
      .safeParse(
        await settings.executor.execute({
          id: `call-${randomUUID()}`,
          name: 'read_project_settings',
          input: {},
        }),
      );
    const proposalsElsewhere = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.chat_proposals
      WHERE org_id = ${orgId} AND project_id = ${otherProjectId}
    `;
    record(
      'chat proposals: a chat filed in a project reads and proposes for that project alone',
      elsewhere.success &&
        elsewhere.data.status === 'invalid_args' &&
        (proposalsElsewhere[0]?.count ?? -1) === 0 &&
        listedHere.success &&
        listedHere.data.projects.map((row) => row.id).join() === projectId,
      `other project=${elsewhere.success ? elsewhere.data.status : 'ERR'}, kept=${proposalsElsewhere[0]?.count ?? 'ERR'}, listed=${listedHere.success ? listedHere.data.projects.length : 'ERR'}`,
    );

    const renaming = await propose({
      change: 'update_agent',
      project: projectId,
      agent: alpha,
      name: `Alpha renamed ${suffix}`,
    });
    // Someone changes the agent on its page after the proposal read it.
    const current = await instructionsOf(alpha);
    const edited = await door('POST', `/projects/agents/${alpha}`, {
      name: current?.name ?? '',
      harness: 'claude-code',
      model: 'itest-agent-model',
      modelProvider: 'itestagent',
      skills: [],
      connectors: [],
      instructions: `Edited on the page. ${suffix}`,
    });
    const staleApply = renaming.success
      ? await decide(renaming.data.proposalId, 'apply')
      : null;
    const afterStale = await instructionsOf(alpha);
    record(
      'chat proposals: an agent changed since the proposal is refused as stale, and stays as the page left it',
      renaming.success &&
        edited.status === 200 &&
        staleApply?.status === 200 &&
        staleApply.body.success &&
        staleApply.body.data.proposal.status === 'failed' &&
        staleApply.body.data.proposal.failure?.reason === 'stale' &&
        afterStale?.name === `Alpha ${suffix}` &&
        afterStale.instructions === `Edited on the page. ${suffix}`,
      `proposed=${renaming.success}, page edit=${edited.status}, apply=${staleApply?.body.success ? `${staleApply.body.data.proposal.status}/${staleApply.body.data.proposal.failure?.reason ?? '-'}` : 'ERR'}, name=${afterStale?.name === `Alpha ${suffix}` ? 'kept' : 'CHANGED'}`,
    );

    const projectName = `Proposed project ${suffix}`;
    const creating = await propose({
      change: 'create_project',
      name: projectName,
    });
    const dismissed = creating.success
      ? await decide(creating.data.proposalId, 'dismiss')
      : null;
    const applyDismissed = creating.success
      ? await decide(creating.data.proposalId, 'apply')
      : null;
    const madeProjects = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.projects
      WHERE org_id = ${orgId} AND name = ${projectName}
    `;
    record(
      'chat proposals: a dismissed proposal stays dismissed and makes nothing',
      creating.success &&
        dismissed?.body.success === true &&
        dismissed.body.data.proposal.status === 'dismissed' &&
        applyDismissed?.body.success === true &&
        applyDismissed.body.data.proposal.status === 'dismissed' &&
        (madeProjects[0]?.count ?? -1) === 0,
      `proposed=${creating.success}, dismiss=${dismissed?.body.success ? dismissed.body.data.proposal.status : 'ERR'}, apply after=${applyDismissed?.body.success ? applyDismissed.body.data.proposal.status : 'ERR'}, projects made=${madeProjects[0]?.count ?? 'ERR'}`,
    );

    // ---- An agent's deletion, and a conversation's ---------------------
    const deleted = await door('DELETE', `/projects/agents/${beta}`);
    const chatsOnBeta = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.thread_metadata
      WHERE org_id = ${orgId} AND chat_agent_id = ${beta}
    `;
    const throwaway = threadCreatedSchema.parse(
      await (await createChat({ projectId })).json(),
    ).id;
    const throwawaySettings = await chatSettingsTools(sql, {
      organizationId: orgId,
      userId: ctx.userId,
      rootThreadId: throwaway,
      projectId,
    });
    const throwawayProposal = proposedSchema.safeParse(
      await throwawaySettings?.executor.execute({
        id: `call-${randomUUID()}`,
        name: 'propose_project_settings',
        input: { change: 'create_project', name: `Gone with ${suffix}` },
      }),
    );
    await sql`DELETE FROM app.threads WHERE id = ${throwaway}`;
    const leftover = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM app.chat_proposals
      WHERE thread_id = ${throwaway}
    `;
    record(
      'chat agents: deleting an agent clears the chats answering as it and the project’s choice of it; a conversation takes its proposals with it',
      deleted.status === 200 &&
        (chatsOnBeta[0]?.count ?? -1) === 0 &&
        (await projectDefaultOf(projectId)) === null &&
        throwawayProposal.success &&
        (leftover[0]?.count ?? -1) === 0,
      `delete=${deleted.status}, chats on it=${chatsOnBeta[0]?.count ?? 'ERR'}, project default=${(await projectDefaultOf(projectId)) ?? 'cleared'}, proposal=${throwawayProposal.success}, left after the chat=${leftover[0]?.count ?? 'ERR'}`,
    );
  } finally {
    await provider.cleanup();
  }
}
