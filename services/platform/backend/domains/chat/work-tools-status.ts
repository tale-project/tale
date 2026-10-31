import type { ChatToolsConfig } from '@tale/shared/schemas/governance';
import type { Sql } from 'postgres';

import {
  type ChatWorkToolReason,
  type ChatWorkToolsStatus,
  type ChatWorkToolStatus,
  SANDBOX_START_FAILURES,
  type SandboxStartFailure,
} from '../../../lib/chat/work-tools-status.ts';
import { DOCUMENT_SKILL_SLUGS } from '../../../lib/shared/document-skills.ts';
import { DAY_MS } from '../../../lib/shared/metrics-window.ts';
import { isRecord } from '../../../lib/utils/type-utils.ts';
import type { ActionCtx } from '../../core/lib/ctx.ts';
import {
  type ImageGenerationStatus,
  inspectImageGenerationModels,
} from '../../core/lib/providers/resolve_image_model.ts';
import { sandboxCapacity } from '../../core/node_only/sandbox/helpers/session_client.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { readSkillCatalog } from '../agent_tools/skills.ts';
import { chatShimHandlers } from './shim.ts';
import { readChatToolSwitches } from './work-tools.ts';

/**
 * Whether chat in the organization can make files, run code, use skills and
 * make images, and why not — for the admins who ask which of it is switched
 * off. Read from the sources a reply reads ({@link chatWorkTools}'s policy
 * switches, the image model, the skill library, the sandbox service), and
 * from the newest sandbox starts the replies recorded; nothing is changed.
 */

/** How far back the newest sandbox start is looked for. */
const SANDBOX_HISTORY_MS = 7 * DAY_MS;
/** The newest messages of that window searched for `run_code` results. */
const SANDBOX_HISTORY_SCAN = 5000;
/** The newest messages with a `run_code` result that are walked. */
const SANDBOX_HISTORY_ROWS = 25;

export type SandboxProbe = 'reachable' | 'not_configured' | 'unreachable';

export interface LastSandboxFailure {
  readonly failure: SandboxStartFailure;
  readonly at: number;
}

export type SkillLibrary =
  | { readonly readable: true; readonly slugs: readonly string[] }
  | { readonly readable: false };

/** What the status is resolved from. */
export interface ChatWorkToolsInputs {
  readonly policy: {
    readonly switches: ChatToolsConfig;
    readonly unreadable: boolean;
  };
  readonly sandbox: SandboxProbe;
  readonly lastSandboxFailure: LastSandboxFailure | null;
  readonly skills: SkillLibrary;
  readonly images: ImageGenerationStatus;
}

/** Whether chat can use each work tool, and why not. A policy switch that
 * is off, a policy that cannot be read, a sandbox service that is missing
 * or silent, a skill library that cannot be read, and an image tool that
 * no reply offers make a tool unavailable; a document skill missing from
 * the library, or a sandbox that failed to start last time, limits it. */
export function resolveChatWorkToolsStatus(
  inputs: ChatWorkToolsInputs,
  checkedAt: number,
): ChatWorkToolsStatus {
  const image = imageStatus(inputs.images);
  return {
    checkedAt,
    tools: [
      { tool: 'files', ...stateOf(policyReasons(inputs.policy, 'files'), []) },
      { tool: 'code', ...codeStatus(inputs) },
      { tool: 'skills', ...skillsStatus(inputs) },
      { tool: 'images', ...stateOf(image.reasons, []) },
    ],
    ...(image.model !== undefined ? { imageModel: image.model } : {}),
  };
}

function stateOf(
  blocking: readonly ChatWorkToolReason[],
  limiting: readonly ChatWorkToolReason[],
): Omit<ChatWorkToolStatus, 'tool'> {
  return {
    state:
      blocking.length > 0
        ? 'unavailable'
        : limiting.length > 0
          ? 'limited'
          : 'available',
    reasons: [...blocking, ...limiting],
  };
}

function policyReasons(
  policy: ChatWorkToolsInputs['policy'],
  tool: keyof ChatToolsConfig,
): ChatWorkToolReason[] {
  if (policy.unreadable) return [{ code: 'policy_unreadable' }];
  return policy.switches[tool] ? [] : [{ code: 'policy_off' }];
}

/** A live answer from the sandbox service outranks a recorded start: the
 * newest failure is named only while the service answers, as the one sign
 * of a host without its runtime image or a sandbox that does not start. */
function codeStatus(
  inputs: ChatWorkToolsInputs,
): Omit<ChatWorkToolStatus, 'tool'> {
  const blocking = policyReasons(inputs.policy, 'code');
  if (inputs.sandbox === 'not_configured') {
    blocking.push({ code: 'sandbox_not_configured' });
  } else if (inputs.sandbox === 'unreachable') {
    blocking.push({ code: 'sandbox_unreachable' });
  }
  const last = inputs.lastSandboxFailure;
  return stateOf(
    blocking,
    inputs.sandbox === 'reachable' && last !== null
      ? [{ code: 'sandbox_start_failed', failure: last.failure, at: last.at }]
      : [],
  );
}

function skillsStatus(
  inputs: ChatWorkToolsInputs,
): Omit<ChatWorkToolStatus, 'tool'> {
  const blocking = policyReasons(inputs.policy, 'skills');
  if (!inputs.skills.readable) {
    return stateOf([...blocking, { code: 'skill_library_unreadable' }], []);
  }
  const present = new Set(inputs.skills.slugs);
  const missing = DOCUMENT_SKILL_SLUGS.filter((slug) => !present.has(slug));
  return stateOf(
    blocking,
    missing.length > 0 ? [{ code: 'document_skills_missing', missing }] : [],
  );
}

/** The image tool, as the Image generation settings see it: a policy that
 * cannot be read says only that; otherwise the switch, then the model,
 * which the organization's EU/EEA rule may refuse. */
function imageStatus(images: ImageGenerationStatus): {
  reasons: ChatWorkToolReason[];
  model?: { providerName: string; modelId: string };
} {
  const code = images.error?.code;
  if (
    code === 'IMAGE_GENERATION_POLICY_INVALID' ||
    code === 'IMAGE_GENERATION_POLICY_UNAVAILABLE'
  ) {
    return { reasons: [{ code: 'image_policy_unreadable' }] };
  }
  const reasons: ChatWorkToolReason[] = images.enabled
    ? []
    : [{ code: 'image_generation_off' }];
  const pick = images.pick;
  if (code === 'NO_IMAGE_GENERATION_MODEL') {
    reasons.push({ code: 'no_image_model' });
  } else if (code === 'IMAGE_GENERATION_MODEL_UNAVAILABLE') {
    reasons.push({ code: 'image_model_unavailable' });
  } else if (code === 'MODEL_ENDPOINT_OUTSIDE_EU') {
    reasons.push({ code: 'image_model_outside_eu' });
  } else if (code === 'MODEL_ENDPOINT_POLICY_UNREADABLE') {
    reasons.push({ code: 'model_access_unreadable' });
  } else if (code !== undefined) {
    reasons.push({ code: 'image_model_check_failed' });
  } else if (pick === null) {
    reasons.push({ code: 'no_image_model' });
  }
  if (pick === null || reasons.length > 0) return { reasons };
  const option = images.models.find(
    (model) =>
      model.providerSlug === pick.providerSlug &&
      model.modelId === pick.modelId,
  );
  return {
    reasons,
    model: {
      providerName: option?.providerDisplayName ?? pick.providerSlug,
      modelId: pick.modelId,
    },
  };
}

/** The newest sandbox start the rows record, newest first: `null` when it
 * got a sandbox, or none is recorded; its failure when it did not. A
 * program's own error or time-out is not a start, and is passed over. */
export function lastSandboxFailure(
  rows: readonly { readonly at: number; readonly parts: unknown }[],
): LastSandboxFailure | null {
  for (const row of rows) {
    const parts: unknown = row.parts;
    if (!Array.isArray(parts)) continue;
    const list: readonly unknown[] = parts;
    for (const part of list.toReversed()) {
      if (
        !isRecord(part) ||
        part.type !== 'tool-result' ||
        part.capabilityId !== 'run_code' ||
        !isRecord(part.output)
      ) {
        continue;
      }
      const { sandbox, reason } = part.output;
      if (sandbox === 'started' || sandbox === 'reused') return null;
      const failure = SANDBOX_START_FAILURES.find((known) => known === reason);
      if (failure !== undefined) return { failure, at: row.at };
    }
  }
  return null;
}

/** The newest `run_code` results of the last week's replies: one bounded
 * page of the newest messages, the ones with such a result among them. */
async function readLastSandboxFailure(
  sql: Sql,
  organizationId: string,
  now: number,
): Promise<LastSandboxFailure | null> {
  const rows = await sql<{ at: number; parts: unknown }[]>`
    SELECT created_at_ms::float8 AS "at", parts
    FROM (
      SELECT created_at_ms, parts FROM app.messages
      WHERE org_id = ${organizationId}
        AND created_at_ms >= ${now - SANDBOX_HISTORY_MS}
      ORDER BY created_at_ms DESC
      LIMIT ${SANDBOX_HISTORY_SCAN}
    ) recent
    WHERE parts @> '[{"type":"tool-result","capabilityId":"run_code"}]'::jsonb
    ORDER BY created_at_ms DESC
    LIMIT ${SANDBOX_HISTORY_ROWS}
  `;
  return lastSandboxFailure(rows);
}

/** Whether the sandbox service answers now — the check the Sandboxes
 * settings make. Its own words stay in the server log. */
async function probeSandbox(organizationId: string): Promise<SandboxProbe> {
  if (!process.env.SANDBOX_TOKEN?.trim()) return 'not_configured';
  try {
    await sandboxCapacity(organizationId);
    return 'reachable';
  } catch (error) {
    console.warn(
      `[chat] work tool status of ${organizationId}: the sandbox service did not answer:`,
      error instanceof Error ? error.message : 'unknown failure',
    );
    return 'unreachable';
  }
}

/** The document skills the organization's library holds, as the
 * organization sees it — not one person's view of it. */
async function readSkillLibrary(
  sql: Sql,
  organizationId: string,
): Promise<SkillLibrary> {
  const orgSlug = await resolveOrgSlug(sql, organizationId);
  if (orgSlug === null) return { readable: false };
  try {
    const catalog = await readSkillCatalog(
      orgSlug,
      { kind: 'org' },
      DOCUMENT_SKILL_SLUGS,
    );
    return { readable: true, slugs: catalog.map((entry) => entry.slug) };
  } catch (error) {
    console.warn(
      `[chat] work tool status of ${organizationId}: the skill library cannot be read:`,
      error instanceof Error ? error.message : 'unknown failure',
    );
    return { readable: false };
  }
}

export async function readChatWorkToolsStatus(
  sql: Sql,
  organizationId: string,
): Promise<ChatWorkToolsStatus> {
  const now = Date.now();
  // The ctx a turn resolves its image model through.
  const shim = createCtxShim(chatShimHandlers(sql));
  const [policy, sandbox, lastFailure, skills, images] = await Promise.all([
    readChatToolSwitches(sql, organizationId),
    probeSandbox(organizationId),
    readLastSandboxFailure(sql, organizationId, now),
    readSkillLibrary(sql, organizationId),
    inspectImageGenerationModels(
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the resolver reads org slugs, provider credentials and one policy, all served by these handlers
      shim as unknown as ActionCtx,
      organizationId,
    ),
  ]);
  return resolveChatWorkToolsStatus(
    { policy, sandbox, lastSandboxFailure: lastFailure, skills, images },
    now,
  );
}
