import { cn } from '@tale/ui/cn';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import {
  Check,
  Cpu,
  HelpCircle,
  Mail,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useRef } from 'react';

import { useT } from '@/lib/i18n/client';

import {
  type AutomationScenario,
  type RunTone,
  useAutomationScenario,
} from './demo-scenarios';
import { DemoShell } from './demo-shell';
import { useDemoTimeline } from './use-demo-timeline';

const easeOut = [0.22, 1, 0.36, 1] as const;

// Step vocabulary mirrors workflows.ts: trigger|llm|condition|action.
// Icons from step-icons.tsx: Zap / Cpu / HelpCircle / Mail (action).
const BEATS = [0, 400, 1500, 2600, 3700, 4800, 5800, 6800, 7600] as const;
const BEAT = {
  frame: 0,
  trigger: 1,
  llm: 2,
  condition: 3,
  branch: 4,
  action: 5,
  log1: 6,
  log2: 7,
  log3: 8,
} as const;

/**
 * D4 — workflow canvas + Executions table. Nodes mirror workflow-step.tsx
 * (border-l-4, icon in colored box); log mirrors ExecutionsTable rows.
 */
export function AutomationRun({
  scenario,
}: {
  /** Story override — defaults to the homepage inbox-triage workflow. */
  scenario?: AutomationScenario;
}) {
  const { t } = useT('home');
  const homeScenario = useAutomationScenario();
  const scene = scenario ?? homeScenario;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-15%' });
  const beat = useDemoTimeline({ beats: BEATS, start: inView });
  const reduceMotion = useReducedMotion();

  return (
    <div ref={ref}>
      <DemoShell
        label={scene.label}
        title={t('demos.automation.windowTitle')}
        activeNav="automations"
        className="mx-auto aspect-[7/10] max-w-4xl sm:aspect-[16/9]"
      >
        <div className="bg-surface-site flex h-full flex-col gap-3 p-3 md:gap-4 md:p-4">
          {/* Canvas — dotted surface like xyflow Background. */}
          <div
            className="border-border-base bg-surface-site-raised shadow-site-card relative flex flex-1 flex-col justify-center overflow-hidden rounded-xl border p-3 md:px-4 md:py-5"
            style={{
              backgroundImage:
                'radial-gradient(color-mix(in oklab, var(--color-border-strong) 40%, transparent) 1px, transparent 1px)',
              backgroundSize: '14px 14px',
            }}
          >
            <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center md:justify-center md:gap-2">
              <StepNode
                icon={Zap}
                kind={t('demos.automation.kindTrigger')}
                label={scene.trigger}
                state={nodeState(beat, BEAT.trigger)}
                accent="trigger"
              />
              <Connector filled={beat > BEAT.trigger} />
              <StepNode
                icon={Cpu}
                kind={t('demos.automation.kindLlm')}
                label={scene.llm}
                state={nodeState(beat, BEAT.llm)}
                accent="llm"
              />
              <Connector filled={beat > BEAT.llm} />
              <StepNode
                icon={HelpCircle}
                kind={t('demos.automation.kindCondition')}
                label={scene.condition}
                state={nodeState(beat, BEAT.condition)}
                accent="condition"
              />
              <Connector
                filled={beat >= BEAT.action}
                pill={beat >= BEAT.branch ? scene.branchYes : undefined}
              />
              <div className="flex flex-col gap-2">
                <StepNode
                  icon={Mail}
                  kind={t('demos.automation.kindAction')}
                  label={scene.action}
                  state={nodeState(beat, BEAT.action)}
                  accent="action"
                />
                <StepNode
                  icon={Mail}
                  kind={t('demos.automation.kindAction')}
                  label={scene.actionAlt}
                  state="dimmed"
                  accent="action"
                />
              </div>
            </div>
          </div>

          {/* Executions table idiom — not a freeform log panel. */}
          <div className="border-border-base bg-surface-site-raised shadow-site-card mt-auto shrink-0 overflow-hidden rounded-xl border">
            <p className="text-fg-base border-border-base border-b px-3 py-2.5 text-xs font-medium md:px-4">
              {t('demos.automation.logTitle')}
            </p>
            <div className="text-fg-subtle border-border-base/70 grid grid-cols-[1fr_1.4fr_0.8fr] gap-2 border-b px-3 py-1.5 text-[10px] font-medium tracking-wide uppercase md:px-4">
              <span>{t('demos.automation.logColRun')}</span>
              <span>{t('demos.automation.logColStatus')}</span>
              <span className="text-right">
                {t('demos.automation.logColDuration')}
              </span>
            </div>
            <div className="flex flex-col">
              {scene.runs.map((row, index) =>
                beat >= BEAT.log1 + index ? (
                  <ExecRow
                    key={row.run}
                    run={row.run}
                    status={t(TONE_STATUS_KEY[row.tone])}
                    duration={row.duration}
                    tone={row.tone}
                    reduceMotion={reduceMotion ?? false}
                  />
                ) : null,
              )}
            </div>
          </div>
        </div>
      </DemoShell>
    </div>
  );
}

/* Execution statuses mirror the product ExecutionsTable vocabulary —
   the localized words are chrome, the per-run tone is scenario data. */
const TONE_STATUS_KEY: Record<RunTone, string> = {
  done: 'demos.automation.statusCompleted',
  pending: 'demos.automation.statusAwaiting',
  running: 'demos.automation.statusRunning',
};

type NodeState = 'idle' | 'active' | 'done' | 'dimmed';
type Accent = 'trigger' | 'llm' | 'condition' | 'action';

function nodeState(beat: number, own: number): NodeState {
  if (beat === own) return 'active';
  if (beat > own) return 'done';
  return 'idle';
}

/* Colors mirror getStepTypeColor / getStepAccentBorder in
   services/platform/app/features/workflows/utils/step-icons.tsx. */
const ACCENT: Record<Accent, string> = {
  trigger: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  llm: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  condition:
    'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  action:
    'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
};

const ACCENT_BAR: Record<Accent, string> = {
  trigger: 'border-l-blue-500',
  llm: 'border-l-violet-500',
  condition: 'border-l-amber-500',
  action: 'border-l-indigo-500',
};

function StepNode({
  icon: Icon,
  kind,
  label,
  state,
  accent,
}: {
  icon: LucideIcon;
  kind: string;
  label: string;
  state: NodeState;
  accent: Accent;
}) {
  return (
    <div
      className={cn(
        'border-border-base bg-surface-site-raised relative flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-lg border border-l-4 py-2.5 pr-2.5 pl-2 shadow-sm transition-all duration-300 md:min-w-[9.5rem] md:flex-initial',
        ACCENT_BAR[accent],
        state === 'active' && 'ring-fg-base/15 ring-2',
        state === 'dimmed' && 'opacity-40',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-md p-1',
          ACCENT[accent],
        )}
      >
        <Icon className="size-3.5" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-fg-subtle block text-[10px] font-medium tracking-wide">
          {kind}
        </span>
        <span className="text-fg-base block truncate text-xs font-medium">
          {label}
        </span>
      </span>
      {state === 'done' ? (
        <Check
          aria-hidden
          className="text-fg-muted size-3.5 shrink-0"
          strokeWidth={2.5}
        />
      ) : null}
    </div>
  );
}

function Connector({ filled, pill }: { filled: boolean; pill?: string }) {
  return (
    <div
      aria-hidden
      className="relative mx-auto flex shrink-0 items-center justify-center md:mx-0"
    >
      <div className="bg-border-base relative h-4 w-px overflow-hidden md:h-px md:w-5">
        <div
          className={cn(
            'bg-brand-base absolute inset-0 origin-top scale-y-0 transition-transform duration-500 md:origin-left md:scale-x-0 md:scale-y-100',
            filled && 'scale-y-100 md:scale-x-100',
          )}
        />
      </div>
      {pill ? (
        <span className="border-border-base bg-surface-site-raised text-fg-muted absolute rounded-full border px-1.5 py-px text-[9px] font-medium shadow-sm">
          {pill}
        </span>
      ) : null}
    </div>
  );
}

function ExecRow({
  run,
  status,
  duration,
  tone,
  reduceMotion,
}: {
  run: string;
  status: string;
  duration: string;
  tone: 'done' | 'pending' | 'running';
  reduceMotion: boolean;
}) {
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: easeOut }}
      className="text-fg-muted border-border-base/60 grid grid-cols-[1fr_1.4fr_0.8fr] items-center gap-2 border-b px-3 py-2 text-xs last:border-b-0 md:px-4"
    >
      <span className="text-fg-base font-medium tabular-nums">{run}</span>
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium',
            tone === 'done'
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
              : tone === 'running'
                ? 'bg-blue-500/15 text-blue-700 dark:text-blue-400'
                : 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
          )}
        >
          {status}
        </span>
      </span>
      <span className="text-right tabular-nums">{duration}</span>
    </motion.div>
  );
}
