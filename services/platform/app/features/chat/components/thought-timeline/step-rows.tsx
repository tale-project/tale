'use client';

import { Row } from '@tale/ui/layout';
import {
  ChevronRight,
  Loader2,
  TriangleAlert,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-utils';

import { formatToolDetail } from '../../utils/format-tool-detail';
import { routeReasonLabel, type RouteReason } from '../../utils/route-reason';
import {
  subAgentReport,
  subAgentSteps,
  type SubAgentStep,
  type ThoughtStep,
} from '../../utils/thought-step-types';
import {
  markdownComponents,
  markdownWrapperStyles,
} from '../message-bubble/markdown-renderer';
import { TypewriterText } from '../typewriter-text';
import { REASONING_MARKDOWN_COMPONENTS } from './reasoning-markdown';
import { toolIcon } from './tool-icon';

/**
 * The single subordination indent, shared by the inline reasoning body AND the
 * nested delegation timeline so they read as the SAME peer construct — one
 * `border-l` level, never a stack of them. (Previously these diverged:
 * `ml-1.5 border-l pl-3` for reasoning vs `ml-5 border-l pl-3` for delegation.)
 */
export const STEP_INDENT = 'border-border/60 ml-2 border-l pl-3';

type StepStatus = 'active' | 'error' | 'done';

/**
 * The one row primitive every icon+title step renders through (tools, routing,
 * delegation), so they all share the exact same left edge, leading-icon column,
 * and spacing. A SINGLE leading glyph conveys state — a spinner while live, a
 * warning on error, otherwise the family icon — instead of the old two-glyph
 * (status dot + family icon) layout. The title text already names the work, so
 * one glyph is enough and the rows stay flat.
 */
function StepRow({
  icon: Icon,
  status,
  title,
  detail,
  expandedContent,
}: {
  icon: LucideIcon;
  status: StepStatus;
  title: ReactNode;
  /** Optional second line (an error message, or a routing reason). */
  detail?: ReactNode;
  /** Drill-down detail (e.g. a tool's full input/output). When present the
   *  title becomes a chevron-led toggle; `detail` hides while expanded since
   *  the expanded body carries the same information in full. */
  expandedContent?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const hasExpansion = expandedContent != null;
  return (
    <Row gap={2} align="start" className="text-sm">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        {status === 'active' ? (
          <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
        ) : status === 'error' ? (
          <TriangleAlert className="text-destructive size-3.5" />
        ) : (
          <Icon className="text-muted-foreground size-3.5" />
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        {hasExpansion ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={expanded ? bodyId : undefined}
            className={cn(
              'text-foreground flex items-center gap-1.5 text-left',
              'hover:text-foreground/80 cursor-pointer',
            )}
          >
            <ChevronRight
              className={cn(
                'text-muted-foreground size-3 shrink-0 transition-transform',
                expanded && 'rotate-90',
              )}
            />
            <span className="truncate">{title}</span>
          </button>
        ) : (
          <span className="text-foreground truncate">{title}</span>
        )}
        {expanded && <div id={bodyId}>{expandedContent}</div>}
        {detail != null && !expanded && (
          <span
            className={cn(
              'text-xs break-words',
              status === 'error'
                ? 'text-destructive/80'
                : 'text-muted-foreground',
            )}
          >
            {detail}
          </span>
        )}
      </span>
    </Row>
  );
}

/** Full input text for a tool step's expanded detail (the command, file path,
 *  pattern, or a JSON dump of the args). Distinct from the collapsed one-liner,
 *  which truncates. */
function toolInputText(
  step: Extract<ThoughtStep, { kind: 'tool' }>,
): string | undefined {
  const input = step.input;
  if (!input) return undefined;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const direct =
    str(input.command) ??
    str(input.file_path) ??
    str(input.notebook_path) ??
    str(input.pattern) ??
    str(input.url) ??
    // ExitPlanMode (plan/act workflow): show the proposed plan markdown
    // itself, not a JSON dump of {plan, planFilePath}.
    str(input.plan);
  if (direct) return direct;
  const keys = Object.keys(input);
  if (keys.length === 0) return undefined;
  try {
    return JSON.stringify(input, null, 2);
  } catch (error) {
    console.warn('thought-timeline: unserializable tool input', error);
    return undefined;
  }
}

/** Output/result text for a tool step's expanded detail. */
function toolOutputText(
  step: Extract<ThoughtStep, { kind: 'tool' }>,
): string | undefined {
  if (step.output === undefined || step.output === null) return undefined;
  if (typeof step.output === 'string') {
    return step.output.length > 0 ? step.output : undefined;
  }
  try {
    return JSON.stringify(step.output, null, 2);
  } catch (error) {
    console.warn('thought-timeline: unserializable tool output', error);
    return undefined;
  }
}

// Cap the expanded detail so a giant clone/diff output can't blow up the DOM;
// the scroll box shows the head and notes the truncation.
const TOOL_DETAIL_MAX = 4000;

function clampDetail(text: string): string {
  return text.length > TOOL_DETAIL_MAX
    ? `${text.slice(0, TOOL_DETAIL_MAX)}\n… (truncated)`
    : text;
}

/** Synthesize a tool `ThoughtStep` from a folded sub-agent step so the nested
 *  rows render through the SAME `ToolStepRow` as top-level tools. A step with no
 *  output yet (live, mid-flight) reads as still-providing-input so it spins. */
function synthSubStep(
  parentId: string,
  s: SubAgentStep,
  index: number,
): Extract<ThoughtStep, { kind: 'tool' }> {
  const state = s.isError
    ? 'output-error'
    : s.output !== undefined
      ? 'output-available'
      : 'input-available';
  return {
    kind: 'tool',
    id: `${parentId}-sub-${index}`,
    toolName: s.toolName,
    state,
    input: isRecord(s.input) ? s.input : undefined,
    output: s.output,
    errorText: s.isError && typeof s.output === 'string' ? s.output : undefined,
  };
}

/** The expanded body of a sub-agent Task/Agent card: the sub-agent's final
 *  report (markdown) above its tool steps, each nested through `ToolStepRow`.
 *  Replaces the raw `{report,steps}` JSON the folded output would otherwise
 *  dump, and reuses STEP_INDENT for the one shared subordination level. */
function SubAgentActivity({
  parentId,
  report,
  steps,
  active,
}: {
  parentId: string;
  report: string | undefined;
  steps: SubAgentStep[];
  active: boolean;
}) {
  return (
    <div className={cn('mt-2 flex flex-col gap-2', STEP_INDENT)}>
      {report && (
        <div className={cn(markdownWrapperStyles, 'max-w-none text-sm')}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {report}
          </ReactMarkdown>
        </div>
      )}
      {steps.map((s, i) => (
        <ToolStepRow
          key={`${parentId}-sub-${i}`}
          step={synthSubStep(parentId, s, i)}
          active={active}
        />
      ))}
    </div>
  );
}

export function ToolStepRow({
  step,
  active,
}: {
  step: Extract<ThoughtStep, { kind: 'tool' }>;
  /** Whether the OWNING message is still streaming. A tool stuck at
   *  input-available on a finished/aborted turn must NOT show a live spinner. */
  active: boolean;
}) {
  const { t } = useT('chat');
  const { displayText } = formatToolDetail(t, step.toolName, step.input);
  const isActive =
    active &&
    (step.state === 'input-streaming' || step.state === 'input-available');
  const isError = step.state === 'output-error';
  // A Task/Agent card folds its sub-agent's activity (report + tool steps) into
  // `output`; render that nested instead of the raw JSON blob.
  const subSteps = subAgentSteps(step);
  const inputText = toolInputText(step);
  // Suppress the raw output `<pre>` for a folded Task — its `output` is the
  // `{report,steps}` object, surfaced by the nested timeline below.
  const outputText = subSteps ? undefined : toolOutputText(step);
  // Only the agent-tool steps (Bash/Read/…) carry input+output worth drilling
  // into; the expander appears when there's detail to show.
  const hasDetail = Boolean(inputText || outputText || subSteps);
  return (
    <StepRow
      icon={toolIcon(step.toolName)}
      // Non-active and never reached a terminal state (e.g. aborted mid-call,
      // left at input-available) resolves to 'done' → it shows the family icon,
      // NOT a spinner or a misleading success mark.
      status={isActive ? 'active' : isError ? 'error' : 'done'}
      title={displayText}
      detail={isError && step.errorText ? step.errorText : undefined}
      expandedContent={
        hasDetail ? (
          <div className="mt-1 ml-4 flex flex-col gap-1.5">
            {inputText && (
              <pre className="bg-muted/60 text-muted-foreground max-h-60 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
                {clampDetail(inputText)}
              </pre>
            )}
            {outputText && (
              <pre
                className={cn(
                  'max-h-60 overflow-auto rounded p-2 text-xs whitespace-pre-wrap',
                  isError
                    ? 'bg-destructive/10 text-destructive/90'
                    : 'bg-muted/40 text-foreground/80',
                )}
              >
                {clampDetail(outputText)}
              </pre>
            )}
            {subSteps && (
              <SubAgentActivity
                parentId={step.id}
                report={subAgentReport(step)}
                steps={subSteps}
                active={active}
              />
            )}
          </div>
        ) : undefined
      }
    />
  );
}

export function RoutingStepRow({
  agentName,
  reason,
}: {
  agentName: string;
  reason: RouteReason;
}) {
  const { t } = useT('chat');
  return (
    <StepRow
      icon={Waypoints}
      status="done"
      title={t('routing.routedTo', { agent: agentName })}
      detail={routeReasonLabel(t, reason)}
    />
  );
}

/**
 * Reasoning prose — rendered inside the collapsible `InlineReasoning` body, not
 * through `StepRow` (it's a paragraph, not an icon+title row). Reveals with the
 * SAME smooth typewriter the answer uses while the block is live; a finished or
 * aborted block renders in full immediately. Redacted blocks show a neutral note.
 */
export function ReasoningStepRow({
  step,
  active,
}: {
  step: Extract<ThoughtStep, { kind: 'reasoning' }>;
  /** Whether the OWNING message is still streaming — a reasoning block left
   *  stuck at `streaming` on an aborted turn must NOT keep animating. */
  active: boolean;
}) {
  const { t } = useT('chat');
  if (step.redacted) {
    return (
      <p className="text-muted-foreground text-sm italic">
        {t('thinking.redacted')}
      </p>
    );
  }
  return (
    <TypewriterText
      text={step.text}
      isStreaming={active && step.state === 'streaming'}
      components={REASONING_MARKDOWN_COMPONENTS}
      className="text-muted-foreground text-sm"
    />
  );
}
