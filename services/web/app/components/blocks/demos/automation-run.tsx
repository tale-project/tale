import { cn } from '@tale/ui/cn';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import {
  Check,
  GitBranch,
  Mail,
  PenLine,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useRef } from 'react';

import { useT } from '@/lib/i18n/client';

import { DemoShell } from './demo-shell';
import { useDemoTimeline } from './use-demo-timeline';

const easeOut = [0.22, 1, 0.36, 1] as const;

// Execution sweep: each step pulses, ticks, and fills its outgoing
// connector; the condition picks the "yes" branch; the log appends.
// Step vocabulary mirrors the platform's workflow schema
// (services/platform/lib/shared/schemas/workflows.ts: trigger|llm|
// condition|action|...).
const BEATS = [0, 400, 1500, 2600, 3700, 4800, 5800, 6800] as const;
const BEAT = {
  frame: 0,
  trigger: 1,
  llm: 2,
  condition: 3,
  branch: 4,
  action: 5,
  log1: 6,
  log2: 7,
} as const;

/**
 * D4 — an automation's workflow executing: Trigger → LLM → Condition →
 * Action, with the taken branch highlighted and execution-log rows
 * appending as the run completes.
 */
export function AutomationRun() {
  const { t } = useT('home');
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-15%' });
  const beat = useDemoTimeline({ beats: BEATS, start: inView });
  const reduceMotion = useReducedMotion();

  return (
    <div ref={ref}>
      <DemoShell
        label={t('demos.automation.label')}
        title={t('demos.automation.windowTitle')}
        className="mx-auto aspect-[7/10] max-w-4xl sm:aspect-[16/9]"
      >
        <div className="flex h-full flex-col gap-5 p-4 md:gap-6 md:p-6">
          <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
            <StepNode
              icon={Mail}
              kind={t('demos.automation.kindTrigger')}
              label={t('demos.automation.trigger')}
              state={nodeState(beat, BEAT.trigger)}
            />
            <Connector filled={beat > BEAT.trigger} />
            <StepNode
              icon={Sparkles}
              kind={t('demos.automation.kindLlm')}
              label={t('demos.automation.llm')}
              state={nodeState(beat, BEAT.llm)}
            />
            <Connector filled={beat > BEAT.llm} />
            <StepNode
              icon={GitBranch}
              kind={t('demos.automation.kindCondition')}
              label={t('demos.automation.condition')}
              state={nodeState(beat, BEAT.condition)}
              badge={
                beat >= BEAT.branch
                  ? t('demos.automation.branchYes')
                  : undefined
              }
            />
            <Connector filled={beat >= BEAT.action} />
            <div className="flex flex-col gap-2">
              <StepNode
                icon={PenLine}
                kind={t('demos.automation.kindAction')}
                label={t('demos.automation.action')}
                state={nodeState(beat, BEAT.action)}
              />
              <StepNode
                icon={PenLine}
                kind={t('demos.automation.kindAction')}
                label={t('demos.automation.actionAlt')}
                state="dimmed"
              />
            </div>
          </div>

          <div className="border-border-base bg-surface-site mt-auto shrink-0 rounded-xl border">
            <p className="text-fg-subtle border-border-base border-b px-4 py-2 text-xs font-medium tracking-wide uppercase">
              {t('demos.automation.logTitle')}
            </p>
            <div className="flex flex-col px-4 py-1">
              {beat >= BEAT.log1 ? (
                <LogRow
                  text={t('demos.automation.log1')}
                  reduceMotion={reduceMotion ?? false}
                />
              ) : null}
              {beat >= BEAT.log2 ? (
                <LogRow
                  text={t('demos.automation.log2')}
                  reduceMotion={reduceMotion ?? false}
                />
              ) : null}
            </div>
          </div>
        </div>
      </DemoShell>
    </div>
  );
}

type NodeState = 'idle' | 'active' | 'done' | 'dimmed';

function nodeState(beat: number, own: number): NodeState {
  if (beat === own) return 'active';
  if (beat > own) return 'done';
  return 'idle';
}

function StepNode({
  icon: Icon,
  kind,
  label,
  state,
  badge,
}: {
  icon: LucideIcon;
  kind: string;
  label: string;
  state: NodeState;
  badge?: string;
}) {
  return (
    <div
      className={cn(
        'border-border-base bg-surface-site flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-all duration-300',
        state === 'active' &&
          'ring-accent-base/30 border-accent-base/40 ring-2',
        state === 'dimmed' && 'opacity-45',
      )}
    >
      <span className="border-border-base bg-surface-site-inset flex size-7 shrink-0 items-center justify-center rounded-lg border">
        <Icon aria-hidden className="text-fg-muted size-3.5" />
      </span>
      <span className="min-w-0">
        <span className="text-fg-subtle block text-[10px] font-medium tracking-wide uppercase">
          {kind}
        </span>
        <span className="text-fg-base block truncate text-xs font-medium md:text-[13px]">
          {label}
        </span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {badge ? (
          <span className="border-border-base bg-surface-site-inset text-fg-muted rounded px-1.5 py-0.5 text-[10px] font-medium">
            {badge}
          </span>
        ) : null}
        {state === 'done' ? (
          <Check
            aria-hidden
            className="text-fg-muted size-3.5"
            strokeWidth={2.5}
          />
        ) : null}
      </span>
    </div>
  );
}

function Connector({ filled }: { filled: boolean }) {
  return (
    <div
      aria-hidden
      className="bg-border-base relative mx-auto h-4 w-px shrink-0 overflow-hidden md:mx-0 md:h-px md:w-5"
    >
      <div
        className={cn(
          'bg-accent-base absolute inset-0 origin-top scale-y-0 transition-transform duration-500 md:origin-left md:scale-y-100 md:scale-x-0',
          filled && 'scale-y-100 md:scale-x-100',
        )}
      />
    </div>
  );
}

function LogRow({
  text,
  reduceMotion,
}: {
  text: string;
  reduceMotion: boolean;
}) {
  return (
    <motion.p
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: easeOut }}
      className="text-fg-muted border-border-base flex items-center gap-2 border-b py-2 text-xs last:border-b-0"
    >
      <Check aria-hidden className="size-3 shrink-0" strokeWidth={2.5} />
      {text}
    </motion.p>
  );
}
