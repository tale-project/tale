import type { StandardAgentConfig } from '@tale/shared/schemas/governance';
import type { Sql, TransactionSql } from 'postgres';

import {
  type ChatChoiceEntry,
  chooseChatModel,
  eligibleChatCandidates,
} from '../../../lib/chat/model-choice.ts';
import { DOCUMENT_SKILL_SLUGS } from '../../../lib/shared/document-skills.ts';
import { getOrganizationDefaultLocale } from '../../../lib/shared/utils/get-organization-default-locale.ts';
import type { ComposerModelOption } from '../../core/chat/composer.ts';
import { catalogString } from '../../core/i18n/catalog.ts';
import { loadHarnesses } from '../../core/lib/providers/load_system_config.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import {
  listGovernedChatModels,
  listProjectCapabilities,
} from '../chat/composer.ts';
import {
  alignManagedProjectAgent,
  assertProjectActive,
  assertReadable,
  eligibleProjectAgentHarnesses,
  insertManagedProjectAgent,
  loadProjectOrThrow,
  ProjectError,
  type ProjectAuthContext,
} from './service.ts';

/**
 * The organization's standard agent: the project agent Tale provides in
 * every project that has none of its own, so work can go to an agent before
 * anyone sets one up — without it a Member, who cannot create agents, had
 * nowhere to hand a file task in such a project.
 *
 * The `standard_agent` governance policy decides it (on by default; runtime
 * and model automatic unless an Admin pins them). The agent itself is a
 * real `app.project_agents` row marked `managed` (migration 0146), created
 * the first time someone hands work to the project (`ensureStandardAgent`),
 * so every path that runs, mentions or lists an agent works unchanged; and
 * whenever a run starts, the kick resolves the policy again and runs what it
 * says now (`standardAgentServingForKick`), writing any change back to the
 * row.
 *
 * "Automatic" is resolved for the person the run acts for: the models they
 * may use (governance model access applied), chosen by the chat's own Auto
 * rules at the band document work gets. A pinned model is used or refused,
 * never replaced by another.
 */

/** The runtime an automatic standard agent runs on: the one automation
 * agent steps default to, and able to run any directly served model through
 * the gateway. */
const STANDARD_AGENT_DEFAULT_HARNESS = 'claude-code';

/** The standing instructions a standard agent works with unless the policy
 * replaces them. General on purpose: it is every project's agent until the
 * project gets its own. */
export const STANDARD_AGENT_DEFAULT_INSTRUCTIONS = [
  "You are this organization's standard agent: the agent a project's tasks go to until the project has agents of its own.",
  'Do what the task asks, using the files attached to it and its comments. When it asks for a file — a document, a presentation, a spreadsheet, a PDF — deliver that file as a task output, in the format it asks for.',
  'Write in the language of the task. Close with a comment that says what you did and what is still open.',
  'When the task is unclear or needs a decision you cannot make, ask in a comment instead of guessing.',
].join('\n\n');

/** Why the standard agent cannot run. */
export type StandardAgentRefusal =
  /** The organization switched it off. */
  | 'off'
  /** Its policy file cannot be read, or does not parse. */
  | 'unreadable'
  /** The pinned runtime is not one a project agent may run on. */
  | 'harness-invalid'
  /** Nothing this person may use can run it. */
  | 'no-model'
  /** The pinned model is not one this person may use, or its runtime
   * cannot run it. */
  | 'pin-unavailable';

export type StandardAgentServing =
  | {
      ok: true;
      harness: string;
      model: string;
      modelProvider: string;
      /** Where the model came from — the pin, or the automatic choice. */
      source: 'pinned' | 'preferred' | 'cheapest';
    }
  | {
      ok: false;
      refusal: Exclude<StandardAgentRefusal, 'off' | 'unreadable'>;
    };

/**
 * The policy as it stands, or `unreadable`. A missing file is the default —
 * on, everything automatic. Read strictly (fresh from disk): the kick, the
 * availability read and the ensure door must agree, and a broken file must
 * never read as "on with defaults".
 */
export async function readStandardAgentPolicy(
  sql: Sql | TransactionSql,
  organizationId: string,
): Promise<StandardAgentConfig | 'unreadable'> {
  try {
    const policy = await readGovernancePolicyForOrg(
      sql,
      organizationId,
      'standard_agent',
      { strict: true },
    );
    return policy ?? { enabled: true };
  } catch (error) {
    console.warn(
      `[standard-agent] policy unreadable for organization ${organizationId}:`,
      error instanceof Error ? error.message : error,
    );
    return 'unreadable';
  }
}

/** The runtime a subscription-served option is bound to; `undefined` for a
 * directly served (api-key/env) option, which any runtime can run. */
function boundHarness(option: ComposerModelOption): string | undefined {
  const credential = option.credential;
  return credential.authMethod === 'api-key' || credential.authMethod === 'env'
    ? undefined
    : credential.constraints.harness;
}

/**
 * What runs the standard agent, from the models a person may use. Pure: the
 * listing and the eligible runtimes in, the choice or the refusal out.
 */
export function chooseStandardAgentServing(
  options: readonly ComposerModelOption[],
  config: Pick<StandardAgentConfig, 'harness' | 'providerSlug' | 'modelId'>,
  eligibleHarnesses: readonly string[],
): StandardAgentServing {
  if (
    config.harness !== undefined &&
    !eligibleHarnesses.includes(config.harness)
  ) {
    return { ok: false, refusal: 'harness-invalid' };
  }
  const defaultHarness = eligibleHarnesses.includes(
    STANDARD_AGENT_DEFAULT_HARNESS,
  )
    ? STANDARD_AGENT_DEFAULT_HARNESS
    : eligibleHarnesses[0];
  const runnable = (option: ComposerModelOption, harness: string) => {
    const bound = boundHarness(option);
    return bound === undefined || bound === harness;
  };

  if (config.providerSlug !== undefined && config.modelId !== undefined) {
    const pinned = options.filter(
      (option) =>
        option.providerSlug === config.providerSlug &&
        option.id === config.modelId,
    );
    const direct = pinned.some((option) => boundHarness(option) === undefined);
    const harness =
      config.harness ??
      (direct ? defaultHarness : pinned.map(boundHarness).find(Boolean));
    if (
      harness === undefined ||
      !eligibleHarnesses.includes(harness) ||
      !pinned.some((option) => runnable(option, harness))
    ) {
      return { ok: false, refusal: 'pin-unavailable' };
    }
    return {
      ok: true,
      harness,
      model: config.modelId,
      modelProvider: config.providerSlug,
      source: 'pinned',
    };
  }

  // Automatic: with a runtime pinned, what it can run; otherwise the directly
  // served models (the default runtime runs any of them), and only when there
  // are none, a subscription's model on the runtime it is bound to.
  let pool: readonly ComposerModelOption[];
  if (config.harness !== undefined) {
    const pinnedHarness = config.harness;
    pool = options.filter((option) => runnable(option, pinnedHarness));
  } else {
    const direct = options.filter(
      (option) => boundHarness(option) === undefined,
    );
    pool =
      direct.length > 0 && defaultHarness !== undefined
        ? direct
        : options.filter((option) => {
            const bound = boundHarness(option);
            return bound !== undefined && eligibleHarnesses.includes(bound);
          });
  }
  const screened = eligibleChatCandidates(
    pool.map((option) => {
      const entry: ChatChoiceEntry & { option: ComposerModelOption } = {
        id: option.id,
        provider: option.providerSlug,
        tags: [...option.tags],
        supportsTools: option.tools,
        supportsVision: option.vision === true,
        option,
      };
      if (option.pricing !== undefined) entry.pricing = option.pricing;
      return entry;
    }),
    { requiresVision: false },
  );
  if ('refusal' in screened) return { ok: false, refusal: 'no-model' };
  // Document work is the standard agent's everyday task: the band the chat's
  // Auto floors document work at.
  const choice = chooseChatModel(screened.pool, 'standard');
  if (choice === null) return { ok: false, refusal: 'no-model' };
  const harness =
    config.harness ?? boundHarness(choice.entry.option) ?? defaultHarness;
  if (harness === undefined) return { ok: false, refusal: 'harness-invalid' };
  return {
    ok: true,
    harness,
    model: choice.entry.id,
    modelProvider: choice.entry.provider,
    source: choice.source,
  };
}

/** What runs the standard agent for this person, under this policy. */
export async function resolveStandardAgentServing(
  sql: Sql | TransactionSql,
  args: {
    organizationId: string;
    userId: string;
    config: StandardAgentConfig;
  },
): Promise<StandardAgentServing> {
  const eligible = eligibleProjectAgentHarnesses();
  if (
    args.config.harness !== undefined &&
    !eligible.includes(args.config.harness)
  ) {
    return { ok: false, refusal: 'harness-invalid' };
  }
  const options = await listGovernedChatModels(sql as Sql, {
    organizationId: args.organizationId,
    userId: args.userId,
  });
  return chooseStandardAgentServing(options, args.config, eligible);
}

/** Whether this person can hand work to the standard agent now, and what
 * it would run on — the picker, the chat's hand-over, the Agents tab and
 * the governance page all read this. */
export interface StandardAgentAvailability {
  enabled: boolean;
  available: boolean;
  refusal?: StandardAgentRefusal;
  harness?: string;
  harnessLabel?: string;
  model?: string;
  modelLabel?: string;
  modelProvider?: string;
  source?: 'pinned' | 'preferred' | 'cheapest';
}

export async function readStandardAgentAvailability(
  sql: Sql,
  args: { organizationId: string; userId: string },
): Promise<StandardAgentAvailability> {
  const config = await readStandardAgentPolicy(sql, args.organizationId);
  if (config === 'unreadable') {
    return { enabled: false, available: false, refusal: 'unreadable' };
  }
  if (!config.enabled) {
    return { enabled: false, available: false, refusal: 'off' };
  }
  const eligible = eligibleProjectAgentHarnesses();
  const options =
    config.harness !== undefined && !eligible.includes(config.harness)
      ? []
      : await listGovernedChatModels(sql, args);
  const serving = chooseStandardAgentServing(options, config, eligible);
  if (!serving.ok) {
    return { enabled: true, available: false, refusal: serving.refusal };
  }
  const harnessLabel = loadHarnesses().find(
    (harness) => harness.slug === serving.harness,
  )?.displayName;
  const modelLabel = options.find(
    (option) =>
      option.id === serving.model &&
      option.providerSlug === serving.modelProvider,
  )?.label;
  return {
    enabled: true,
    available: true,
    harness: serving.harness,
    ...(harnessLabel !== undefined ? { harnessLabel } : {}),
    model: serving.model,
    ...(modelLabel !== undefined ? { modelLabel } : {}),
    modelProvider: serving.modelProvider,
    source: serving.source,
  };
}

/** The refusal a door answers when the standard agent cannot be used. */
function refusalError(refusal: StandardAgentRefusal): ProjectError {
  return refusal === 'off'
    ? new ProjectError(
        'STANDARD_AGENT_OFF',
        "The organization's standard agent is switched off. An Owner or Admin can switch it on under Governance.",
        403,
      )
    : new ProjectError(
        'STANDARD_AGENT_UNAVAILABLE',
        refusal === 'unreadable'
          ? "The organization's standard agent settings cannot be read. An Owner or Admin can check them under Governance."
          : refusal === 'harness-invalid'
            ? "The runtime chosen for the organization's standard agent is not available. An Owner or Admin can choose another under Governance."
            : refusal === 'pin-unavailable'
              ? "The model chosen for the organization's standard agent is not one you can use. An Owner or Admin can choose another under Governance."
              : "No model you can use can run the organization's standard agent. An Owner or Admin can set up an AI provider, or give you access to a model.",
        409,
        { reason: refusal },
      );
}

/** The standard agent's name, in the organization's language: it reads
 * like any agent's in every list and handle. */
async function standardAgentName(
  sql: Sql | TransactionSql,
  organizationId: string,
): Promise<string> {
  const rows = await sql<{ metadata: unknown }[]>`
    SELECT metadata FROM "organization" WHERE id = ${organizationId} LIMIT 1
  `;
  const locale = getOrganizationDefaultLocale(rows[0]?.metadata);
  return (
    catalogString(locale, 'projects.agents.standard.name') ?? 'Standard agent'
  );
}

/**
 * The project's standard agent, created if it has none yet — the door a
 * Member (or anyone who can open the project) uses to hand it work. Answers
 * the standing managed agent when there is one; refuses a project with
 * agents of its own (its people chose those), an archived one, and a
 * standard agent that is switched off or cannot run for this person.
 */
export async function ensureStandardAgent(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  projectId: string,
): Promise<{ agentId: string; created: boolean }> {
  const project = await loadProjectOrThrow(tx, projectId);
  assertReadable(project, auth);
  assertProjectActive(project);

  const agents = await tx<{ id: string; managed: boolean }[]>`
    SELECT id, managed FROM app.project_agents
    WHERE project_id = ${projectId}
    ORDER BY managed DESC
  `;
  const standing = agents.find((agent) => agent.managed);
  if (standing !== undefined) {
    return { agentId: standing.id, created: false };
  }
  if (agents.length > 0) {
    throw new ProjectError(
      'STANDARD_AGENT_NOT_NEEDED',
      'This project has agents of its own; assign one of them',
      409,
    );
  }

  const config = await readStandardAgentPolicy(tx, auth.organizationId);
  if (config === 'unreadable') throw refusalError('unreadable');
  if (!config.enabled) throw refusalError('off');
  const serving = await resolveStandardAgentServing(tx, {
    organizationId: auth.organizationId,
    userId: auth.userId,
    config,
  });
  if (!serving.ok) throw refusalError(serving.refusal);

  const { skills } = await listProjectCapabilities(tx, {
    organizationId: auth.organizationId,
    userId: auth.userId,
    projectId,
  });
  const visible = new Set(skills.map((skill) => skill.slug));
  return insertManagedProjectAgent(tx, auth, project, {
    name: await standardAgentName(tx, auth.organizationId),
    harness: serving.harness,
    model: serving.model,
    modelProvider: serving.modelProvider,
    skills: DOCUMENT_SKILL_SLUGS.filter((slug) => visible.has(slug)),
    instructions: config.instructions ?? STANDARD_AGENT_DEFAULT_INSTRUCTIONS,
  });
}

/**
 * The kick's view of the agent it is about to start: for the standard
 * agent, what the policy says NOW — resolved for the person the run acts
 * for — written back to its row when it moved; for any other agent, what
 * the caller read. Refuses with the policy's reason instead of queuing a run
 * that cannot start: `STANDARD_AGENT_OFF` (403) or
 * `STANDARD_AGENT_UNAVAILABLE` (409).
 */
export async function standardAgentServingForKick(
  tx: TransactionSql,
  args: {
    organizationId: string;
    agentId: string;
    /** Who the run acts for: a person's id, or a trigger's
     * (`trigger:<id>`), which answers to the agent's creator. */
    startedBy: string;
    harness: string;
    model: string;
    modelProvider?: string;
  },
): Promise<{ harness: string; model: string; modelProvider?: string }> {
  const rows = await tx<
    { managed: boolean; projectId: string; createdBy: string }[]
  >`
    SELECT managed, project_id AS "projectId", created_by AS "createdBy"
    FROM app.project_agents
    WHERE id = ${args.agentId} AND org_id = ${args.organizationId}
    LIMIT 1
  `;
  const agent = rows[0];
  const passthrough = {
    harness: args.harness,
    model: args.model,
    ...(args.modelProvider !== undefined
      ? { modelProvider: args.modelProvider }
      : {}),
  };
  if (agent === undefined || !agent.managed) return passthrough;

  const config = await readStandardAgentPolicy(tx, args.organizationId);
  if (config === 'unreadable') throw refusalError('unreadable');
  if (!config.enabled) throw refusalError('off');
  const serving = await resolveStandardAgentServing(tx, {
    organizationId: args.organizationId,
    userId: args.startedBy.startsWith('trigger:')
      ? agent.createdBy
      : args.startedBy,
    config,
  });
  if (!serving.ok) throw refusalError(serving.refusal);
  await alignManagedProjectAgent(
    tx,
    {
      id: args.agentId,
      organizationId: args.organizationId,
      projectId: agent.projectId,
    },
    {
      harness: serving.harness,
      model: serving.model,
      modelProvider: serving.modelProvider,
      instructions: config.instructions ?? STANDARD_AGENT_DEFAULT_INSTRUCTIONS,
    },
  );
  return {
    harness: serving.harness,
    model: serving.model,
    modelProvider: serving.modelProvider,
  };
}

/** The codes a kick answers for a standard agent that cannot run — the
 * retry job retires a failed run on them instead of retrying forever. */
export const STANDARD_AGENT_REFUSAL_CODES: ReadonlySet<string> = new Set([
  'STANDARD_AGENT_OFF',
  'STANDARD_AGENT_UNAVAILABLE',
]);
