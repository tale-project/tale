import type { Sql, TransactionSql } from 'postgres';

import type { ConversationAgent } from '../../../lib/chat/assistant.ts';

/**
 * Who a project chat answers as.
 *
 * A chat filed in a project can answer as one of the project's agents —
 * its instructions lead the persona, its equipped skills are the skills
 * the reply may load, and its model is the composer's when the person picks
 * it — instead of the workspace's chat assistant. The agent's runtime,
 * connectors, platform tools, secrets and repository access stay on tasks:
 * a chat runs on the shared engine (`executeTurn`) and acts for the person
 * chatting, never with more than they may use.
 *
 * The choice belongs to the conversation and is kept on its root thread
 * (`app.thread_metadata.chat_agent_id`, migration 0236). A project's new
 * chats, and the chats moved into it, start with its default chat agent:
 * the agent the project names, else the first agent created in it, else
 * the assistant. The Tale-managed standard agent is the tasks' stand-in
 * for a project without agents and never answers a chat.
 */

/** One agent a chat may answer as. */
export interface ChatAgentChoice {
  id: string;
  name: string;
  model: string;
  modelProvider: string | null;
  skills: string[];
  createdAt: number;
}

/** The project's own agents, oldest first: the ones a chat may answer as. */
export async function listChatAgents(
  sql: Sql | TransactionSql,
  args: { organizationId: string; projectId: string },
): Promise<ChatAgentChoice[]> {
  return sql<ChatAgentChoice[]>`
    SELECT id, name, model, model_provider AS "modelProvider", skills,
           created_at_ms::float8 AS "createdAt"
    FROM app.project_agents
    WHERE org_id = ${args.organizationId} AND project_id = ${args.projectId}
      AND NOT managed
    ORDER BY created_at_ms ASC, id ASC
  `;
}

interface ProjectChatDefault {
  defaultChatAgentId?: string | null;
  chatsStartWithAssistant?: boolean;
}

/**
 * The agent a project's new chats start with, among `agents` (its own,
 * oldest first): the one the project names while it is still there, else
 * the first agent created, else none — the assistant. A project that
 * starts its chats with the assistant names none.
 */
export function resolveDefaultChatAgent(
  project: ProjectChatDefault,
  agents: readonly { id: string }[],
): string | null {
  if (project.chatsStartWithAssistant === true) return null;
  const named =
    project.defaultChatAgentId === null ||
    project.defaultChatAgentId === undefined
      ? undefined
      : agents.find((agent) => agent.id === project.defaultChatAgentId);
  return named?.id ?? agents[0]?.id ?? null;
}

/** The agent a project's new chats start with (`resolveDefaultChatAgent`),
 * read now; none for a project that is not the organization's. */
export async function defaultChatAgentId(
  sql: Sql | TransactionSql,
  args: { organizationId: string; projectId: string },
): Promise<string | null> {
  const [projects, agents] = await Promise.all([
    sql<ProjectChatDefault[]>`
      SELECT default_chat_agent_id AS "defaultChatAgentId",
             chats_start_with_assistant AS "chatsStartWithAssistant"
      FROM app.projects
      WHERE id = ${args.projectId} AND org_id = ${args.organizationId}
      LIMIT 1
    `,
    listChatAgents(sql, args),
  ]);
  const project = projects[0];
  return project === undefined
    ? null
    : resolveDefaultChatAgent(project, agents);
}

/** Whether `agentId` is one of the project's own agents: the only agents a
 * chat of that project may answer as. */
export async function isChatAgentOf(
  sql: Sql | TransactionSql,
  args: { organizationId: string; projectId: string; agentId: string },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM app.project_agents
    WHERE id = ${args.agentId} AND org_id = ${args.organizationId}
      AND project_id = ${args.projectId} AND NOT managed
    LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * The agent a conversation answers as: the one its root names, while that
 * agent is still one of the project's own and the conversation is still
 * filed in that project. Anything else — none chosen, an agent deleted with
 * its project, a chat moved since — answers as the assistant.
 */
export async function readConversationAgent(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    rootThreadId: string;
    projectId: string | null;
  },
): Promise<ConversationAgent | undefined> {
  if (args.projectId === null) return undefined;
  const rows = await sql<
    {
      id: string;
      name: string;
      instructions: string | null;
      skills: string[];
    }[]
  >`
    SELECT pa.id, pa.name, pa.instructions, pa.skills
    FROM app.thread_metadata tm
    JOIN app.project_agents pa
      ON pa.id = tm.chat_agent_id AND pa.org_id = tm.org_id
    WHERE tm.thread_id = ${args.rootThreadId}
      AND tm.org_id = ${args.organizationId}
      AND pa.project_id = ${args.projectId}
      AND NOT pa.managed
    LIMIT 1
  `;
  const row = rows[0];
  if (row === undefined) return undefined;
  return {
    id: row.id,
    name: row.name,
    instructions: row.instructions,
    skills: row.skills,
  };
}

/** Clear every chat that answers as `agentId`: they answer as the
 * assistant from their next reply on. Run in the agent's delete. */
export async function clearChatAgentInTx(
  tx: TransactionSql,
  args: { organizationId: string; agentId: string },
): Promise<void> {
  await tx`
    UPDATE app.thread_metadata SET chat_agent_id = NULL
    WHERE chat_agent_id = ${args.agentId} AND org_id = ${args.organizationId}
  `;
  await tx`
    UPDATE app.projects SET default_chat_agent_id = NULL
    WHERE default_chat_agent_id = ${args.agentId}
      AND org_id = ${args.organizationId}
  `;
}
