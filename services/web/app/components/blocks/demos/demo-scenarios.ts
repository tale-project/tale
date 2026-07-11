import { useT } from '@/lib/i18n/client';
import type { Namespace } from '@/lib/i18n/types';

/**
 * Scenario content for the product demos. Every demo separates two kinds of
 * strings:
 *
 * - **Chrome** — product vocabulary that is identical in every depiction
 *   (column headers, status words, placeholders, step-kind labels). Chrome
 *   always reads from `home.demos.*` inside the demo component.
 * - **Scenario** — the story shown inside the window (prompts, replies,
 *   table rows, workflow labels, approval text). Scenario content lives in
 *   the page namespace that owns the depiction, under the same `demos.<demo>`
 *   key shape as the homepage, and is built here.
 *
 * Each hook reads one demo's scenario from a namespace; components fall back
 * to the homepage scenario when no override is passed. Row counts are fixed
 * per demo — the window frames have fixed aspect ratios, so scenarios vary
 * the story, never the layout.
 */

export interface ChatScenario {
  /** One-sentence `role="img"` description of what this depiction shows. */
  label: string;
  prompt: string;
  routedTitle: string;
  routedDetail: string;
  replies: readonly [string, string, string, string];
  citations: readonly [string, string];
  /** Agent chip after routing resolves (brand/agent name, unlocalized). */
  agentRouted: string;
  model: string;
}

export function useChatScenario(
  ns: Namespace = 'home',
  prefix = 'demos.hero',
): ChatScenario {
  const { t } = useT(ns);
  return {
    label: t(`${prefix}.label`),
    prompt: t(`${prefix}.prompt`),
    routedTitle: t(`${prefix}.routedTitle`),
    routedDetail: t(`${prefix}.routedDetail`),
    replies: [
      t(`${prefix}.reply1`),
      t(`${prefix}.reply2`),
      t(`${prefix}.reply3`),
      t(`${prefix}.reply4`),
    ],
    citations: [t(`${prefix}.citation1`), t(`${prefix}.citation2`)],
    agentRouted: t(`${prefix}.composerAgentRouted`),
    model: t(`${prefix}.composerModel`),
  };
}

export interface AgentsScenario {
  label: string;
  rows: readonly { name: string; model: string }[];
}

export function useAgentsScenario(
  ns: Namespace = 'home',
  prefix = 'demos.connect',
): AgentsScenario {
  const { t } = useT(ns);
  return {
    label: t(`${prefix}.label`),
    rows: [1, 2, 3, 4, 5].map((n) => ({
      name: t(`${prefix}.agent${n}`),
      model: t(`${prefix}.model${n}`),
    })),
  };
}

const KNOWLEDGE_ROW_TYPES = ['pdf', 'website', 'catalog', 'entry'] as const;
export type KnowledgeRowType = (typeof KNOWLEDGE_ROW_TYPES)[number];

function asKnowledgeRowType(value: string): KnowledgeRowType {
  return (KNOWLEDGE_ROW_TYPES as readonly string[]).includes(value)
    ? (value as KnowledgeRowType)
    : 'pdf';
}

export interface KnowledgeScenario {
  label: string;
  rows: readonly { name: string; type: KnowledgeRowType }[];
}

export function useKnowledgeScenario(
  ns: Namespace = 'home',
  prefix = 'demos.knowledge',
): KnowledgeScenario {
  const { t } = useT(ns);
  return {
    label: t(`${prefix}.label`),
    rows: [1, 2, 3, 4].map((n) => ({
      name: t(`${prefix}.source${n}`),
      type: asKnowledgeRowType(t(`${prefix}.sourceType${n}`)),
    })),
  };
}

const RUN_TONES = ['done', 'pending', 'running'] as const;
export type RunTone = (typeof RUN_TONES)[number];

function asRunTone(value: string): RunTone {
  return (RUN_TONES as readonly string[]).includes(value)
    ? (value as RunTone)
    : 'done';
}

export interface AutomationScenario {
  label: string;
  /** Step labels for the fixed trigger → llm → condition → action graph. */
  trigger: string;
  llm: string;
  condition: string;
  branchYes: string;
  action: string;
  actionAlt: string;
  runs: readonly { run: string; tone: RunTone; duration: string }[];
}

export function useAutomationScenario(
  ns: Namespace = 'home',
  prefix = 'demos.automation',
): AutomationScenario {
  const { t } = useT(ns);
  return {
    label: t(`${prefix}.label`),
    trigger: t(`${prefix}.trigger`),
    llm: t(`${prefix}.llm`),
    condition: t(`${prefix}.condition`),
    branchYes: t(`${prefix}.branchYes`),
    action: t(`${prefix}.action`),
    actionAlt: t(`${prefix}.actionAlt`),
    runs: [1, 2, 3].map((n) => ({
      run: t(`${prefix}.run${n}`),
      tone: asRunTone(t(`${prefix}.runTone${n}`)),
      duration: t(`${prefix}.duration${n}`),
    })),
  };
}

export interface GovernScenario {
  label: string;
  approvalTitle: string;
  requester: string;
  journal: readonly [string, string, string];
  budgetValue: string;
}

export function useGovernScenario(
  ns: Namespace = 'home',
  prefix = 'demos.govern',
): GovernScenario {
  const { t } = useT(ns);
  return {
    label: t(`${prefix}.label`),
    approvalTitle: t(`${prefix}.approvalTitle`),
    requester: t(`${prefix}.requester`),
    journal: [
      t(`${prefix}.audit1`),
      t(`${prefix}.audit2`),
      t(`${prefix}.audit3`),
    ],
    budgetValue: t(`${prefix}.budgetValue`),
  };
}

export interface ArenaScenario {
  label: string;
  prompt: string;
  agent: string;
  modelA: string;
  modelB: string;
  repliesA: readonly [string, string, string];
  repliesB: readonly [string, string, string];
}

export function useArenaScenario(
  ns: Namespace = 'home',
  prefix = 'demos.arena',
): ArenaScenario {
  const { t } = useT(ns);
  return {
    label: t(`${prefix}.label`),
    prompt: t(`${prefix}.prompt`),
    agent: t(`${prefix}.agent`),
    modelA: t(`${prefix}.modelA`),
    modelB: t(`${prefix}.modelB`),
    repliesA: [
      t(`${prefix}.replyA1`),
      t(`${prefix}.replyA2`),
      t(`${prefix}.replyA3`),
    ],
    repliesB: [
      t(`${prefix}.replyB1`),
      t(`${prefix}.replyB2`),
      t(`${prefix}.replyB3`),
    ],
  };
}

export interface ProjectsScenario {
  label: string;
  rows: readonly { name: string; agents: string; members: string }[];
}

export function useProjectsScenario(
  ns: Namespace = 'home',
  prefix = 'demos.projects',
): ProjectsScenario {
  const { t } = useT(ns);
  return {
    label: t(`${prefix}.label`),
    rows: [1, 2, 3, 4].map((n) => ({
      name: t(`${prefix}.project${n}`),
      agents: t(`${prefix}.agents${n}`),
      members: t(`${prefix}.members${n}`),
    })),
  };
}

/**
 * Fixed board layout (4 lanes × fixed card slots) — mirrors
 * `BOARD_TASK_STATUSES` lanes Todo → Done from
 * `services/platform/app/features/tasks/lib/display.ts` (backlog/cancelled
 * omitted so the marketing frame stays dense).
 */
export interface TaskBoardCard {
  id: string;
  title: string;
  assignee: string;
}

export interface TaskBoardScenario {
  label: string;
  /** Cards in To do (2), In progress (1), In review (1), Done (1). */
  todo: readonly [TaskBoardCard, TaskBoardCard];
  inProgress: TaskBoardCard;
  inReview: TaskBoardCard;
  done: TaskBoardCard;
}

export function useTaskBoardScenario(
  ns: Namespace = 'home',
  prefix = 'demos.tasks',
): TaskBoardScenario {
  const { t } = useT(ns);
  const card = (n: number): TaskBoardCard => ({
    id: t(`${prefix}.id${n}`),
    title: t(`${prefix}.title${n}`),
    assignee: t(`${prefix}.assignee${n}`),
  });
  return {
    label: t(`${prefix}.label`),
    todo: [card(1), card(2)],
    inProgress: card(3),
    inReview: card(4),
    done: card(5),
  };
}

/**
 * Sandbox chat + Files / Live side pane — vocabulary from
 * `workspace-files-pane.tsx` and `live-browser-pane.tsx` (no platform imports).
 */
export interface SandboxScenario {
  label: string;
  prompt: string;
  agent: string;
  model: string;
  reply: string;
  /** File-tree entries under the workspace root (fixed count). */
  files: readonly [string, string, string, string];
  activeFile: string;
  codeLines: readonly [string, string, string, string];
  browserUrl: string;
  browserTitle: string;
}

export function useSandboxScenario(
  ns: Namespace = 'home',
  prefix = 'demos.sandbox',
): SandboxScenario {
  const { t } = useT(ns);
  return {
    label: t(`${prefix}.label`),
    prompt: t(`${prefix}.prompt`),
    agent: t(`${prefix}.agent`),
    model: t(`${prefix}.model`),
    reply: t(`${prefix}.reply`),
    files: [
      t(`${prefix}.file1`),
      t(`${prefix}.file2`),
      t(`${prefix}.file3`),
      t(`${prefix}.file4`),
    ],
    activeFile: t(`${prefix}.activeFile`),
    codeLines: [
      t(`${prefix}.code1`),
      t(`${prefix}.code2`),
      t(`${prefix}.code3`),
      t(`${prefix}.code4`),
    ],
    browserUrl: t(`${prefix}.browserUrl`),
    browserTitle: t(`${prefix}.browserTitle`),
  };
}
